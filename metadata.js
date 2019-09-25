'use strict';

const METADATA_URL = process.env.ECS_CONTAINER_METADATA_URI;

let _metadata = null;

function fetch(callback) {
    if (_metadata) {
        return callback(null, _metadata)
    }

    _metadata = METADATA_URL.substring(METADATA_URL.lastIndexOf('/'), METADATA_URL.length);

    return callback(null, _metadata);
}

exports.fetch = fetch;
