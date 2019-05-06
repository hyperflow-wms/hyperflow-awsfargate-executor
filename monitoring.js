'use strict';

const INTERFACE = process.env.INTERFACE || 'eth0';
const DISK_OPTS = {
    device: process.env.DISK_DEVICE || 'xvda1',
    units: 'KiB',
};
const TASK_ID = process.env.TASK_ID || 'undefinedTaskId';
const START = process.env.START || 0;
const PUSH_GW_URL = process.env.PUSH_GW_URL || 'http://localhost:9091';
const LABELS = process.env.LABELS || '';
const COLLECT_INTERVAL = 1000;

const si = require('systeminformation');
const os_utils = require('os-utils');
const diskStat = require('disk-stat');
const async = require('async');
const prometheus = require('prom-client');
const gateway = new prometheus.Pushgateway(PUSH_GW_URL);

const fetchMetaData = require('./metadata').fetch;

// splits labels in form of a string: 'key1=val1,key2=val2', to object: {key1: val1, key2: val2}
function parseLabels(labelsString) {
    return labelsString ? labelsString.split(',')
        .map(s => s.split('='))
        .reduce((acc, curr) => {
            acc[curr[0]] = curr[1];
            return acc;
        }, {}) :
    {};
}

const labels = {
    containerID: null,
    taskID: TASK_ID,
    ...parseLabels(LABELS)
};

const labelNames = Object.keys(labels);

const prometheusMetrics = {
    hyperflow_cpu_usage: new prometheus.Gauge({
        name: 'hyperflow_cpu_usage',
        help: 'CPU usage',
        labelNames: labelNames
    }),
    hyperflow_memory_usage: new prometheus.Gauge({
        name: 'hyperflow_memory_usage',
        help: 'Memory usage',
        labelNames: labelNames
    }),
    hyperflow_connection_received: new prometheus.Gauge({
        name: 'hyperflow_connection_received',
        help: 'Received bytes per second',
        labelNames: labelNames
    }),
    hyperflow_connection_transferred: new prometheus.Gauge({
        name: 'hyperflow_connection_transferred',
        help: 'Transferred bytes per second',
        labelNames: labelNames
    }),
    hyperflow_disc_read: new prometheus.Gauge({
        name: 'hyperflow_disc_read',
        help: 'Read kB per second',
        labelNames: labelNames
    }),
    hyperflow_disc_write: new prometheus.Gauge({
        name: 'hyperflow_disc_write',
        help: 'Write kB per second',
        labelNames: labelNames
    }),
    hyperflow_task_execution_time: new prometheus.Gauge({
        name: 'hyperflow_task_execution_time',
        help: 'Task execution time in seconds',
        labelNames: labelNames
    }),
    hyperflow_task_execution_time_buckets: new prometheus.Histogram({
        name: 'hyperflow_task_execution_time_buckets',
        help: 'Task execution time in seconds',
        labelNames: labelNames
    }),
    hyperflow_task_start_time: new prometheus.Gauge({
        name: 'hyperflow_task_start_time',
        help: 'Task start timestamp',
        labelNames: labelNames
    }),
    hyperflow_task_end_time: new prometheus.Gauge({
        name: 'hyperflow_task_end_time',
        help: 'Task end timestamp',
        labelNames: labelNames
    })
};

prometheus.collectDefaultMetrics();

function collectUsage(callback) {
    async.waterfall([
        function (callback) {
            os_utils.cpuUsage(value => {
                prometheusMetrics.hyperflow_cpu_usage.set(labels, value);
                callback(null);
            });
        },
        function (callback) {
            si.mem(data => {
                prometheusMetrics.hyperflow_memory_usage.set(labels, data.used / 1024);
                callback(null);
            });
        },
        function (callback) {
            si.networkStats(INTERFACE, data => {
                prometheusMetrics.hyperflow_connection_received.set(labels, data.rx_sec || 0);
                prometheusMetrics.hyperflow_connection_transferred.set(labels, data.tx_sec || 0);
                callback(null);
            });
        },
        function (callback) {
            diskStat.usageRead(DISK_OPTS, value => {
                prometheusMetrics.hyperflow_disc_read.set(labels, value || 0);
                callback(null);
            });
        },
        function (callback) {
            diskStat.usageWrite(DISK_OPTS, value => {
                prometheusMetrics.hyperflow_disc_write.set(labels, value || 0);
                callback(null);
            });
        },
        function (callback) {
            gateway.pushAdd({jobName: 'hyperflow-service'}, function (err, resp, body) {
                if (err) {
                    return callback(err);
                }
                console.log('Successfully pushed metrics to gateway');
                callback(null);
            });
        }
    ], function (err) {
        if (err) {
            console.warn(`Error while pushing metrics to gateway: ${err.message}`);
        }

        // ignore metrics error, just log them
        if (callback) {
            callback(null);
        }
    });
}

function reportExecTime(start, end, callback) {
    const duration = end - start;
    prometheusMetrics.hyperflow_task_start_time.set(labels, start);
    prometheusMetrics.hyperflow_task_end_time.set(labels, end);
    prometheusMetrics.hyperflow_task_execution_time.set(labels, duration);
    prometheusMetrics.hyperflow_task_execution_time_buckets.observe(labels, duration);

    collectUsage(err => {
        if (err) {
            console.warn(err.message);
        }

        callback(null, duration);
    });
}

function _init(callback) {
    fetchMetaData((err, metadata) => {
        labels.containerID = err ? 'undefinedContainerId' : metadata.Containers[0].DockerId;

        setInterval(collectUsage, COLLECT_INTERVAL);

        callback(null);
    });

}

if (START) {
    _init(() => console.log('Initialized monitoring service'));
} else {
    exports.init = _init;
    exports.reportExecTime = reportExecTime;
}