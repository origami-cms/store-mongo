import {Store} from 'origami-store-base';
import mongoose, {Mongoose} from 'mongoose';
import MongoModel from './Model';

module.exports = class MongoStore extends Store {
    _connection?: Mongoose;
    _model: new(...args: any[]) => MongoModel = MongoModel;

    async connect() {
        this._connection = await mongoose.connect(this.connURI, {
            useMongoClient: true,
            promiseLibrary: global.Promise
        });
        return this._connection;
    }

    async disconnect() {
        mongoose.disconnect();
    }
};
