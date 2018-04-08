import mongoose from 'mongoose';

import {Origami, requireKeys} from 'origami-core-lib';
import Model from './Model';

// mongoose.set('debug', true);

const REQUIRED_OPTIONS = [
    'username',
    'password',
    'host',
    'port',
    'database'
];


mongoose.Promise = global.Promise;
// @ts-ignore
mongoose.Types.ObjectId.isValid(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);


module.exports = class MongoDBStore implements Origami.Store.Store {
    models: { [name: string]: Origami.Store.Model } = {};
    connURI: string;


    private _options: Origami.Store.StoreOptions;

    constructor(options: Origami.Store.StoreOptions) {
        const o = this._options = {...{
            host: '127.0.0.1',
            port: 27017
        }, ...options};


        // Validate the options
        try {
            requireKeys(REQUIRED_OPTIONS, this._options);
        } catch (e) {
            throw new Error(`Origami.MongoDBStore: Missing '${e.key}' setting`);
        }


        this.connURI = `mongodb://${o.username}:${o.password}@${o.host}:${o.port}/${o.database}`;
    }


    async connect() {
        await mongoose.connect(this.connURI, {
            useMongoClient: true,
            promiseLibrary: global.Promise
        });
    }


    model(name: string, schema?: Origami.Store.Schema): Origami.Store.Model | void {
        // Lookup model
        if (!schema) {
            const m = this.models[name];
            if (!m) throw new Error(`Origami.MongoDBStore: No model with name '${name}'`);
            else return m;

        // Define a new model
        } else {
            this.models[name] = new Model(name, schema);
        }
    }
};
