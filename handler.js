'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const async = require('async');
const aws = require('aws-sdk');
const s3 = new aws.S3();

const init = require('./monitoring').init;

function handleRequest(request) {
    if (request.s3) {
        const params = {
            Bucket: request.options.bucket,
            Key: `${request.options.prefix}/${request.s3}`
        };
        s3.getObject(params, (err, data) => {
            if (err) {
                console.error(`Error downloading job message file from S3 - bucket: ${params.Bucket}, key: ${params.Key}`);
                process.exit(1);
            }
            handle(JSON.parse(data.Body.toString()));
        })
    } else {
        handle(request);
    }
}

function handle(request) {
    const start = Date.now();

    const executable = request.executable;
    const args = request.args;
    const bucket_name = request.options.bucket;
    const prefix = request.options.prefix;
    const inputs = request.inputs.map(input => input.name);
    const outputs = request.outputs.map(output => output.name);
    const files = inputs.slice();
    files.push(executable);

    console.log(`Executable: ${executable}`);
    console.log(`Arguments: ${args}`);
    console.log(`Inputs: ${inputs}`);
    console.log(`Outputs: ${outputs}`);
    console.log(`Bucket: ${bucket_name}`);
    console.log(`Prefix: ${prefix}`);
    console.log(`Stdout: ${request.stdout}`);
    console.log(`PATH: ${process.env.PATH}`);

    async.waterfall([
        init,
        download,
        execute,
        upload,
    ], function (err, reporter, previousData) {
        if (err) {
            console.error(`Error in waterfall: ${err}`);
            process.exit(1);
        } else {
            const end = Date.now();

            reporter.report({start: start, end: end, ...previousData}, function (err) {
                if (err) {
                    console.error(`Error on reporting exec time: ${err}`);
                }

                console.log(`AWS Fargate exit: duration ${end - start} ms, executable: ${executable}, args: ${args}`);
                process.exit(0);
            });
        }
    });

    function download(reporter, callback) {
        const downloadStart = Date.now();

        async.each(files, function (file, callback) {

            console.log(`Downloading ${bucket_name}/${prefix}/${file}`);

            const params = {
                Bucket: bucket_name,
                Key: `${prefix}/${file}`
            };

            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log(`Error downloading file ${JSON.stringify(params)}`);
                    process.exit(1);
                } else {
                    const path = "/tmp/" + file;

                    fs.writeFile(path, data.Body, function (err) {
                        if (err) {
                            console.log(`Unable to save file ${path}`);
                            process.exit(1)
                        }

                        console.log(`Downloaded and saved file ${path}`);

                        fs.chmod(path, '777', callback);
                    });
                }
            });
        }, function (err) {
            if (err) {
                console.error(`Failed to download file: ${err}`);
                process.exit(1)
            } else {
                console.log(`All files have been downloaded successfully`);

                callback(null, reporter, {
                    download_start: downloadStart,
                    download_end: Date.now()
                });
            }
        });
    }

    function execute(reporter, previousData, callback) {
        const executeStart = Date.now();

        const proc_name = `/tmp/${executable}`;

        let proc;
        console.log("Running executable" + proc_name);

        if (proc_name.endsWith('.js')) {
            proc = childProcess.fork(proc_name, args, {cwd: '/tmp'});
        } else if (proc_name.endsWith('.jar')) {
            let java_args = ['-jar', proc_name];
            const program_args = java_args.concat(args);
            proc = childProcess.spawn('java', program_args, {cwd: '/tmp'});
        } else {
            proc = childProcess.spawn(proc_name, args, {cwd: '/tmp', env: {PATH: process.env.PATH}});

            proc.stdout.on('data', function (exedata) {
                console.log(`Stdout: ${executable} / ${exedata}`);
            });

            proc.stderr.on('data', function (exedata) {
                console.log(`Stderr: ${executable} / ${exedata}`);
            });
        }

        if (request.stdout) {
            let stdoutStream = fs.createWriteStream(`/tmp/${request.stdout}`, {flags: 'w'});
            proc.stdout.pipe(stdoutStream);
        }

        proc.on('error', function (code) {
            console.error(`Error: ${JSON.stringify(code)}`);
            callback(code);
        });
        proc.on('exit', function () {
            console.log(`My exe exit ${executable}`);
        });

        proc.on('close', function () {
            console.log(`My exe close ${executable}`);

            callback(null, reporter, {execute_start: executeStart, execute_end: Date.now(), ...previousData});
        });
    }

    function upload(reporter, previousData, callback) {
        const uploadStart = Date.now();

        async.each(outputs, function (file, callback) {

            console.log(`Uploading ${bucket_name}/${prefix}/${file}`);
            const path = `/tmp/${file}`;

            fs.readFile(path, function (err, data) {
                if (err) {
                    console.log(`Error reading file ${path}, err: ${err}`);
                    process.exit(1);
                }

                const params = {
                    Bucket: bucket_name,
                    Key: `${prefix}/${file}`,
                    Body: data
                };

                s3.putObject(params, function (err) {
                    if (err) {
                        console.log(`Error uploading file ${file}`);
                        process.exit(1)
                    }
                    console.log(`Uploaded file ${file}`);
                    callback();
                });
            });

        }, function (err) {
            if (err) {
                console.log(`Error uploading file ${err}`);
                process.exit(1);
            } else {
                console.log('All files have been uploaded successfully');

                callback(null, reporter, {upload_start: uploadStart, upload_end: Date.now(), ...previousData})
            }
        });
    }
}

if (!process.argv[2]) {
    console.log('Received empty request, exiting...');
    process.exit(1);
}

handleRequest(JSON.parse(process.argv[2]));
