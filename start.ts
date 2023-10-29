/**
 * Copyright 2023 Kapeta Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import localClusterService from './index';

localClusterService
    .start()
    .then(({ host, port }) => console.log('Listening on port %s:%s', host, port))
    .catch((e) => {
        console.error('Failed to start local cluster due to an error:\n\t - %s', e);
        process.exit(1);
    });
