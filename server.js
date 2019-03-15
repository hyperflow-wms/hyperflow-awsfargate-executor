'use strict';

const bodyParser = require('body-parser');
const express = require('express');
const childProcess = require("child_process");
const fs = require("fs");
const rimraf = require("rimraf");
const async = require("async");
const aws = require("aws-sdk");
const path = require("path");
const s3 = new aws.S3();
const app = express();

const PORT = 8080;
const HOST = '0.0.0.0';

app.use(bodyParser.json());

app.post('/', (req, res) => {
    handleRequest(req, res);
});

app.listen(PORT, HOST);

function handleRequest(req, res) {

    const body = req.body;

    const executable = body.executable;
    const args = body.args;
    const bucket_name = body.options.bucket;
    const prefix = body.options.prefix;
    const inputs = [];
    for (let index = 0; index < body.inputs.length; ++index) {
        inputs.push(body.inputs[index].name);
    }
    const outputs = [];
    for (let index = 0; index < body.outputs.length; ++index) {
        outputs.push(body.outputs[index].name);
    }
    const files = inputs.slice();
    files.push(executable);
    const file_prefix = "aws_"+Math.random().toString(36).substring(2, 8) + Math.random().toString(36).substring(2, 8);

    const t_start = Date.now();

    console.log("Executable: " + executable);
    console.log("Arguments:  " + args);
    console.log("Inputs:      " + inputs);
    console.log("Outputs:    " + outputs);
    console.log("Bucket:     " + bucket_name);
    console.log("Prefix:     " + prefix);
	console.log("Stdout:     " + body.stdout);

    async.waterfall([
        download,
        execute,
        upload
    ], function (err) {
		rimraf("/tmp/" + file_prefix, function () { console.log("Clearing tmp files done: "+file_prefix); });
        let body;
		if (err) {
            console.error("Error: " + err);
			res.status(400);
			body = JSON.stringify("Bad Request: " + JSON.stringify(err));
        } else {
            console.log("Success");
            const t_end = Date.now();
            const duration = t_end - t_start;
			res.status(200);
			body = "AWS Fargate exit: duration " + duration + " ms, executable: " + executable + " args: " + args;
        }
		res.send(body);
    });

    function download(callback) {
        async.each(files, function (file, callback) {

            console.log("Downloading " + bucket_name + "/" + prefix + "/" + file);

            const params = {
                Bucket: bucket_name,
                Key: prefix + "/" + file
            };
            s3.getObject(params, function (err, data) {
                if (err) {
                    console.log("Error downloading file " + JSON.stringify(params));
                    console.log(err);
                    callback(err);
                } else {
                    const path = "/tmp/" + file_prefix + "/" + file;
                    ensureDirectoryExistence(path);
                    fs.writeFile(path, data.Body, function (err) {
                        if (err) {
                            console.log("Unable to save file " + file);
                            callback(err);
                            return;
                        }
                        if (file === executable) {
                            console.log("Downloaded executable " + path);
                        } else {
                            console.log("Downloaded and saved file " + path);
                        }
                        callback();
                    });
                }
            });
        }, function (err) {
            if (err) {
                console.error("Failed to download file:" + err);
				res.status(500);
                res.send("S3 download error: " + JSON.stringify(err));
            } else {
                console.log("All files have been downloaded successfully");
                callback()
            }
        });
    }

    function execute(callback) {
        const proc_name = /tmp/ + file_prefix + "/" + executable;
        fs.chmodSync(proc_name, "777");

        let proc;
        console.log("Running executable" + proc_name);

        if (proc_name.endsWith(".js")) {
            proc = childProcess.fork(proc_name, args, {cwd: "/tmp" + "/" + file_prefix});
        } 
		else if(proc_name.endsWith(".jar")) {
			let java_args = ['-jar', proc_name];
			const program_args = java_args.concat(args);
			proc = childProcess.spawn('java', program_args, {cwd: "/tmp" + "/" + file_prefix});
		}
		else {
            proc = childProcess.spawn(proc_name, args, {cwd: "/tmp" + "/" + file_prefix});

            proc.stdout.on("data", function (exedata) {
                console.log("Stdout: " + executable + exedata);
            });

            proc.stderr.on("data", function (exedata) {
                console.log("Stderr: " + executable + exedata);
            });
        }
		
		if (body.stdout) {
			let stdoutStream = fs.createWriteStream("/tmp" + "/" + file_prefix + "/" + body.stdout, {flags: 'w'});
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
            callback()
        });
    }

    function upload(callback) {
        async.each(outputs, function (file, callback) {

            console.log("Uploading " + bucket_name + "/" + prefix + "/" + file);

            fs.readFile("/tmp/" + file_prefix + "/" + file, function (err, data) {
                if (err) {
                    console.log("Error reading file " + file);
                    console.log(err);
                    callback(err);
                    return;
                }

                const params = {
                    Bucket: bucket_name,
                    Key: prefix + "/" + file,
                    Body: data
                };

                s3.putObject(params, function (err) {
                    if (err) {
                        console.log("Error uploading file " + file);
                        console.log(err);
                        callback(err);
                        return;
                    }
                    console.log("Uploaded file " + file);
                    callback();
                });
            });

        }, function (err) {
            if (err) {
                callback("Error uploading file")
            } else {
                console.log("All files have been uploaded successfully");
                callback()
            }
        });
    }

    function ensureDirectoryExistence(filePath) {
        const dirname = path.dirname(filePath);
        if (fs.existsSync(dirname)) {
            return true;
        }
        ensureDirectoryExistence(dirname);
        fs.mkdirSync(dirname);
    }
}