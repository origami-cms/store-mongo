const test = require('origami-test-store');

test(
    require('../build/store'),
    {
        type: "mongodb",
        host: "localhost",
        port: "27017",
        database: "origami-store-mongodb-test",
        username: "origami",
        password: "origami"
    },
    'yarn db:reset',
    'yarn db:drop'
);

