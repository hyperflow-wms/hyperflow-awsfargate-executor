'use strict';

const INTERFACE = process.env.INTERFACE || null;
const DISK_OPTS = {
    device: process.env.DISK_DEVICE || 'xvda1',
    units: 'KiB',
};
const TASK_ID = process.env.TASK_ID || 'undefinedTaskId';
const START = process.env.START || 0;
const LABELS = process.env.LABELS || '';
const INFLUXDB_HOST = process.env.INFLUXDB_HOST || 'influxdb';
const INFLUXDB_DB_NAME = process.env.INFLUXDB_NAME || 'hyperflow-database';
const COLLECT_INTERVAL = 1000;

const si = require('systeminformation');
const os_utils = require('os-utils');
const diskStat = require('disk-stat');
const async = require('async');
const Influx = require('influx');

const fetchMetaData = require('./metadata').fetch;

const MetricDispatcher = function (err, metadata) {
    this.tags = {
        containerID: err ? 'undefinedContainerId' : metadata,
        taskID: TASK_ID,
        ...this._parseLabels(LABELS)
    };

    this._collectUsage = this._collectUsage.bind(this);

    // initialize influx, create database and start collecting usage
    this._initInflux(INFLUXDB_HOST, INFLUXDB_DB_NAME, Object.keys(this.tags))
        .then(() => setInterval(this._collectUsage, COLLECT_INTERVAL));
};

// splits labels in form of a string: 'key1=val1,key2=val2', to object: {key1: val1, key2: val2}
MetricDispatcher.prototype._parseLabels = function (labelsString) {
    return labelsString ? labelsString.split(',')
            .map(s => s.split('='))
            .reduce((acc, curr) => {
                acc[curr[0]] = curr[1];
                return acc;
            }, {}) :
        {};
};

MetricDispatcher.prototype._initInflux = function (url, dbName, tags) {
    this.influx = new Influx.InfluxDB({
        host: url,
        database: dbName,
        schema: [
            {
                measurement: 'performance',
                fields: {
                    cpu_usage: Influx.FieldType.FLOAT,
                    mem_usage: Influx.FieldType.INTEGER,
                    conn_recv: Influx.FieldType.INTEGER,
                    conn_transferred: Influx.FieldType.INTEGER,
                    disk_read: Influx.FieldType.INTEGER,
                    disk_write: Influx.FieldType.INTEGER
                },
                tags: tags
            },
            {
                measurement: 'hflow_task',
                fields: {
                    start: Influx.FieldType.FLOAT,
                    end: Influx.FieldType.FLOAT,
                    download_start: Influx.FieldType.FLOAT,
                    download_end: Influx.FieldType.FLOAT,
                    execute_start: Influx.FieldType.FLOAT,
                    execute_end: Influx.FieldType.FLOAT,
                    upload_start: Influx.FieldType.FLOAT,
                    upload_end: Influx.FieldType.FLOAT
                },
                tags: tags
            },
        ]
    });

    return this.influx.createDatabase(dbName)
};

MetricDispatcher.prototype._write = function (measurement, fields, callback) {
    this.influx.writeMeasurement(measurement, [{
        tags: this.tags,
        fields: fields
    }]).then(callback).catch(callback);
};

MetricDispatcher.prototype._collectUsage = function () {
    async.waterfall([
        callback => {
            os_utils.cpuUsage(value => this._write('hflow_performance', {cpu_usage: value}, callback));
        },
        callback => {
            si.mem(data => this._write('hflow_performance', {mem_usage: data.used / 1024}, callback));
        },
        callback => {
            si.networkStats(INTERFACE, data => this._write('hflow_performance', {
                conn_recv: data[0].rx_sec,
                conn_transferred: data[0].tx_sec
            }, callback));
        },
        callback => {
            diskStat.usageRead(DISK_OPTS, value => this._write('hflow_performance', {disk_read: value}, callback));
        },
        callback => {
            diskStat.usageWrite(DISK_OPTS, value => this._write('hflow_performance', {disk_write: value}, callback));
        }

    ], function (err) {
        if (err) {
            console.warn(`Error while pushing metrics to tsdb: ${err.message}`);
        } else {
            console.log('Successfully pushed metrics to tsdb');
        }
    });
};

MetricDispatcher.prototype.reportExecTime = function (start, end, callback) {
    this._write('hflow_task', {start: start, end: end}, err => callback(err, end - start));
};

MetricDispatcher.prototype.report = function (fields, callback) {
    this._write('hflow_task', fields, callback);
};

function _init(callback) {
    fetchMetaData((err, metadata) => {
        const reporter = new MetricDispatcher(err, metadata);
        callback(null, reporter);
    });

}

if (START) {
    _init(() => console.log('Initialized monitoring service'));
} else {
    exports.init = _init;
}