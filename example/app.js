'use strict';

// const rethink = require('rethinkdbdash');
const feathers = require('feathers');
const rest = require('feathers-rest');
const socketio = require('feathers-socketio');
const bodyParser = require('body-parser');
const service = require('../lib');
// const r = rethink({
//   db: 'feathers'
// });

const rethinkdb = {
  host: 'localhost',
  port: 28015,
  authKey: '',
  db: 'feathers'
};

let thinky = require('thinky')(rethinkdb);
var type = thinky.type;
var r = thinky.r;
// Create the model
var Todo = thinky.createModel('todos', {
  id: type.string(),
  text: type.string(),
  complete: type.boolean(),
  createdAt: type.date().default(r.now())
});

let counter = 0;
const todoService = service({
  Model: Todo,
  // name: 'todos',
  paginate: {
    default: 2,
    max: 4
  }
}).extend({
  _find (params) {
    params = params || {};
    params.query = params.query || {};
    if (!params.query.$sort) {
      params.query.$sort = {
        title: 1
      };
    }

    return this._super(params);
  },

  create (data, params) {
    data.counter = ++counter;
    return this._super(data, params);
  }
});

// Create a feathers instance.
let app = feathers()
  // Enable REST services
  .configure(rest())
  // Enable Socket.io services
  .configure(socketio())
  // Turn on JSON parser for REST services
  .use(bodyParser.json())
  // Turn on URL-encoded parser for REST services
  .use(bodyParser.urlencoded({
    extended: true
  }));

module.exports = todoService
  .init()
  .then(() => {
    // mount the service
    app.use('/todos', todoService);
    // start the server
    return app.listen(3030);
  });
