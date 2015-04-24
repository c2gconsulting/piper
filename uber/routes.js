var JSX = require('node-jsx').install(),
  React = require('react');

var UberUser = require('../shared/models/UberUser');
var mq = require('../shared/lib/mq');
var logger = require('../shared/lib/log');
var uber = require('./lib/uber');
var routes = require('./routes');
var cache = require('../shared/lib/cache').getRedisClient();
var CACHE_PREFIX = 'uber-handler:';
var ERROR_RESPONSE_CODE = 422;

  
module.exports = {

  hooks: function(req, res) {
    // retrieve message from uber
    // process and set on message queue
    var qbody = req.body;

    // notify handler_main 
    var pub = mq.context.socket('PUB', {routing: 'topic'});
    qdata = { id : new Date().getTime(), header : 'webhook', body : qbody };
    logger.info('UBER_ROUTES_HOOKS: Connecting to MQ Exchange <piper.events.out>...');
    pub.connect('piper.events.out', function() {
      logger.info('UBER_ROUTES_HOOKS: <piper.events.out> connected');
      pub.publish('uber.routes', JSON.stringify(qdata));
    });

  },

  auth: function(req, res) {
    var code = req.query.code;
    var state = req.query.state;
    var cachekey = CACHE_PREFIX + state;
    logger.debug('CACHEKEY: %s', cachekey);

    if (code && state) {
      // get user access token
      uber.getUserAccessToken(code).then(function(data) {
        if (data) {
          cache.hgetall(cachekey).then(function(userdata) {
            if (userdata) {
              // save to database
              var expiryDate = new Date();
              expiryDate.setSeconds(expiryDate.getSeconds() + data.expires_in);

              UberUser.findOneAndUpdate (
                { email: userdata.email }, 
                { email: userdata.email, 
                  access_token: data.access_token,
                  refresh_token: data.refresh_token, 
                  token_scope: data.scope,
                  expiry: expiryDate
                },
                {upsert: true}, function (err) {
                if (err) {
                  logger.error('Unable to update uber user profile: ' + err);
                } else {
                  logger.info('Uber Profile for User %s successfully updated', userdata.email);
                }
              });

              //update cache
              var emailCacheKey = CACHE_PREFIX + userdata.email;
              cache.hset(emailCacheKey, 'access_token', data.access_token); // save to cache

              // notify handler_main 
              var pub = mq.context.socket('PUB', {routing: 'topic'});
              qbody = { access_token : data.access_token };
              qdata = { id : new Date().getTime(), email : userdata.email, header: 'auth', body : qbody };
              logger.info('UBER_ROUTES_AUTH: Connecting to MQ Exchange <piper.events.out>...');
              pub.connect('piper.events.out', function() {
                logger.info('UBER_ROUTES_AUTH: <piper.events.out> connected');
                pub.publish('uber.routes', JSON.stringify(qdata));
              });
            }
            cache.del(cachekey);
          });
        }
      });

    }
    res.render('thankyou');
    
  },

  surge: function(req, res) {
    // process surge confirmation follow up
  }

}