'use strict';

const http = require('http');

const METADATA_URL = process.env.METADATA_URL || 'http://169.254.170.2/v2/metadata';

let _metadata = null;

function fetch(callback) {
    if (_metadata) {
        return callback(null, _metadata)
    }

    http.get(METADATA_URL, res => {
        let body = '';

        res.on('data', chunk => body += chunk);

        res.on('end', () => {
            console.log(`Received metadata ${body} from ${METADATA_URL}`);

            try {
                _metadata = JSON.parse(body)
            } catch (e) {
                console.warn(`Error while parsing metadata: ${e.message}`);
                _metadata = null;
                return callback(e);
            }

            callback(null, _metadata);
        })
    }).on('error', function (e) {
        console.warn(`Error while requesting metadata from ${METADATA_URL}: ${e.message}`);

        callback(e);
    });
}

exports.fetch = fetch;
