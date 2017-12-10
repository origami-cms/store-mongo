const mongoose = require('mongoose');
const {symbols, requireKeys} = require('origami-core-lib');
const Model = require('./Model');

// mongoose.set('debug', true);

const REQUIRED_OPTIONS = [
    'username',
    'password',
    'host',
    'port',
    'database'
];

const s = symbols([
    'options',
    'connURI',
    'connection'
]);


mongoose.Promise = global.Promise;
mongoose.Types.ObjectId.isValid(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);


module.exports = class MongoDBStore {
    constructor(options) {
        const o = this[s.options] = {...{
            host: '127.0.0.1',
            port: 27017
        }, ...options};


        // Validate the options
        try {
            requireKeys(REQUIRED_OPTIONS, this[s.options]);
        } catch (e) {
            throw new Error(`Origami.MongoDBStore: Missing '${e.key}' setting`);
        }

        this.models = {};

        this[s.connURI] = `mongodb://${o.username}:${o.password}@${o.host}:${o.port}/${o.database}`;
    }


    async connect() {
        await mongoose.connect(this[s.connURI], {
            useMongoClient: true,
            promiseLibrary: global.Promise
        });
    }


    model(name, schema) {
        // Lookup model
        if (!schema) {
            const m = this.models[name];
            if (!m) throw new Error(`Origami.MongoDBStore: No model with name '${name}'`);
            else return m;

        // Define a new model
        } else {
            this.models[name] = new Model(name, schema, this[s.store]);
        }
    }
};
