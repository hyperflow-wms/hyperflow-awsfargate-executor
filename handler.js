'use strict';

const childProcess = require("child_process");
const fs = require("fs");
const async = require("async");
const aws = require("aws-sdk");
const s3 = new aws.S3();

function handleRequest(request) {

    const metrics = {
        "fargateStart": Date.now(),
        "fargateEnd": "",
        "downloadStart": "",
        "downloadEnd": "",
        "executionStart": "",
        "executionEnd": "",
        "uploadStart": "",
        "uploadEnd": "",
    };

    const executable = request.executable;
    const args = request.args;
    const bucket_name = request.options.bucket;
    const prefix = request.options.prefix;
    const inputs = request.inputs.map(input => input.name);
    const outputs = request.outputs.map(output => output.name);
    const files = inputs.slice();
    const logName = request.logName;
    files.push(executable);

    console.log("Executable: " + executable);
    console.log("Arguments:  " + args);
    console.log("Inputs:     " + inputs);
    console.log("Outputs:    " + outputs);
    console.log("Bucket:     " + bucket_name);
    console.log("Prefix:     " + prefix);
    console.log("Stdout:     " + request.stdout);

    async.waterfall([
        download,
        execute,
        upload
    ], async function (err) {
        if (err) {
            console.error("Error: " + err);
            process.exit(1)
        } else {
            console.log("Success");
            metrics.fargateEnd = Date.now();
            const metricsString = "fargate start: " + metrics.fargateStart + " fargate end: " + metrics.fargateEnd +
                " download start: " + metrics.downloadStart + " download end: " + metrics.downloadEnd +
                " execution start: " + metrics.executionStart + " execution end: " + metrics.executionEnd +
                " upload start: " + metrics.uploadStart + " upload end: " + metrics.uploadEnd;
            if (logName !== undefined) {
                await s3.putObject({
                    Bucket: bucket_name,
                    Key: "logs/" + logName,
                    ContentType: 'text/plain',
                    Body: metricsString
                }).promise();
            } else {
                console.log(metricsString);
            }
        }
    });

    function download(callback) {
        metrics.downloadStart = Date.now();
        async.each(files, function (file, callback) {

            console.log("Downloading " + bucket_name + "/" + prefix + "/" + file);

            const params = {
                Bucket: bucket_name,
                Key: prefix + "/" + file
            };
            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log("Error downloading file " + JSON.stringify(params));
                    process.exit(1)
                } else {
                    const path = "/tmp/" + file;
                    fs.writeFile(path, data.Body, function (err) {
                        if (err) {
                            console.log("Unable to save file " + path);
                            process.exit(1)
                        }
                        console.log("Downloaded " + path);
                        console.log("Downloaded and saved file " + path);
                        callback();
                    });
                }
            });
        }, function (err) {
            metrics.downloadEnd = Date.now();
            if (err) {
                console.error("Failed to download file:" + err);
                process.exit(1)
            } else {
                console.log("All files have been downloaded successfully");
                callback()
            }
        });
    }

    function execute(callback) {
        metrics.executionStart = Date.now();
        const proc_name = /tmp/ + "/" + executable;
        fs.chmodSync(proc_name, "777");

        let proc;
        console.log("Running executable" + proc_name);

        if (proc_name.endsWith(".js")) {
            proc = childProcess.fork(proc_name, args, {cwd: "/tmp"});
        } else if (proc_name.endsWith(".jar")) {
            let java_args = ['-jar', proc_name];
            const program_args = java_args.concat(args);
            proc = childProcess.spawn('java', program_args, {cwd: "/tmp"});
        } else {
            proc = childProcess.spawn(proc_name, args, {cwd: "/tmp"});

            proc.stdout.on("data", function (exedata) {
                console.log("Stdout: " + executable + exedata);
            });

            proc.stderr.on("data", function (exedata) {
                console.log("Stderr: " + executable + exedata);
            });
        }

        if (request.stdout) {
            let stdoutStream = fs.createWriteStream("/tmp" + "/" + request.stdout, {flags: 'w'});
            proc.stdout.pipe(stdoutStream);
        }

        proc.on("error", function (code) {
            console.error("Error!!" + executable + JSON.stringify(code));
        });
        proc.on("exit", function () {
            console.log("My exe exit " + executable);
        });

        proc.on("close", function () {
            console.log("My exe close " + executable);
            metrics.executionEnd = Date.now();
            callback()
        });
    }

    function upload(callback) {
        metrics.uploadStart = Date.now();
        async.each(outputs, function (file, callback) {

            console.log("Uploading " + bucket_name + "/" + prefix + "/" + file);
            const path = "/tmp/" + file;

            fs.readFile(path, function (err, data) {
                if (err) {
                    console.log("Error reading file " + path);
                    process.exit(1)
                }

                const params = {
                    Bucket: bucket_name,
                    Key: prefix + "/" + file,
                    Body: data
                };

                s3.putObject(params, function (err) {
                    if (err) {
                        console.log("Error uploading file " + file);
                        process.exit(1)
                    }
                    console.log("Uploaded file " + file);
                    callback();
                });
            });

        }, function (err) {
            metrics.uploadEnd = Date.now();
            if (err) {
                console.log("Error uploading file " + err);
                process.exit(1)
            } else {
                console.log("All files have been uploaded successfully");
                callback()
            }
        });
    }
}

let arg = process.argv[2];

if (!arg) {
    console.log("Received empty request, exiting...");
    process.exit(1);
}

if (arg.startsWith("S3")) {
    const params = JSON.parse(arg.split("=")[1]);
    console.log("Getting executable config from S3: " + JSON.stringify(params));
    s3.getObject(params, function (err, data) {
        if (err)
            return err;
        arg = data.Body.toString();
        handleRequest(JSON.parse(arg));
    });
} else {
    handleRequest(JSON.parse(arg));
}