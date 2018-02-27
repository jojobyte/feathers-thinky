'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

exports.createFilter = createFilter;

var _feathersCommons = require('feathers-commons');

// Special parameter to RQL condition
var mappings = {
  $search: 'match',
  $contains: 'contains',
  $lt: 'lt',
  $lte: 'le',
  $gt: 'gt',
  $gte: 'ge',
  $ne: 'ne',
  $eq: 'eq'
};

function createFilter(query, r) {
  return function (doc) {
    var or = query.$or;
    var and = query.$and;
    var matcher = r({});

    // Handle $or. If it exists, use the first $or entry as the base matcher
    if (Array.isArray(or)) {
      matcher = createFilter(or[0], r)(doc);

      for (var i = 0; i < or.length; i++) {
        matcher = matcher.or(createFilter(or[i], r)(doc));
      }
      // Handle $and
    } else if (Array.isArray(and)) {
      matcher = createFilter(and[0], r)(doc);

      for (var _i = 0; _i < and.length; _i++) {
        matcher = matcher.and(createFilter(and[_i], r)(doc));
      }
    }

    _feathersCommons._.each(query, function (value, field) {
      if ((typeof value === 'undefined' ? 'undefined' : _typeof(value)) !== 'object') {
        // Match value directly
        matcher = matcher.and(doc(field).eq(value));
      } else {
        // Handle special parameters
        _feathersCommons._.each(value, function (selector, type) {
          if (type === '$in') {
            matcher = matcher.and(r.expr(selector).contains(doc(field)));
          } else if (type === '$nin') {
            matcher = matcher.and(r.expr(selector).contains(doc(field)).not());
          } else if (mappings[type]) {
            var method = mappings[type];

            matcher = matcher.and(doc(field)[method](selector));
          }
        });
      }
    });

    return matcher;
  };
}