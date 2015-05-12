var Event = require('../models/Event');
var logger = require('./log');
var moment = require('moment');
var mq = require('./mq');
var when = require('when');
var cache = require('./cache').getRedisClient();

var CACHE_PREFIX = 'scheduler:';
