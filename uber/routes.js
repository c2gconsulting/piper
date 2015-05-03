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
    logger.debug('================> Hook: $s', JSON.stringify(qbody));

    // notify handler_main 
    var pub = mq.context.socket('PUB', {routing: 'topic'});
    var qdata = { id : new Date().getTime(), header : 'webhook', body : qbody };
    logger.info('UBER_ROUTES_HOOKS: Connecting to MQ Exchange <piper.events.out>...');
    pub.connect('piper.events.out', function() {
      logger.info('UBER_ROUTES_HOOKS: <piper.events.out> connected');
      pub.publish('uber.routes', JSON.stringify(qdata));
    });
    res.send('OK');
  }, 
  auth: function(req, res) {
    var code = req.query.code;
    var state = req.query.state;
    var cachekey = CACHE_PREFIX + state;
    logger.debug('CACHEKEY: %s', cachekey);

    if (code && state) {
      logger.debug('Code: %s and State: %s', code, state);
      // get user access token
      uber.getUserAccessToken(code).then(function(data) {
        logger.debug('Token Feedback: %s', JSON.stringify(data));
        if (data) {
          cache.hgetall(cachekey).then(function(userdata) {
            if (userdata) {
              logger.debug('Cached ref: %s', JSON.stringify(userdata));
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
              cache.expire(emailCacheKey, data.expires_in);

              // notify handler_main 
              var pub = mq.context.socket('PUB', {routing: 'topic'});
              var qbody = { access_token : data.access_token };
              var qdata = { id : new Date().getTime(), email : userdata.email, header: 'auth', body : qbody };
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
    //res.redirect('slack://open');
  },

  surge: function(req, res) {
    var surge_confirmation_id = req.query.surge_confirmation_id;
    var cachekey = CACHE_PREFIX + surge_confirmation_id;
    logger.debug('CACHEKEY: %s', cachekey);

    if (surge_confirmation_id) {
      logger.debug('Surge Confirmation ID: %s', surge_confirmation_id);
      
          cache.get(cachekey).then(function(email) {
            if (email) {
              logger.debug('Cached email: %s', email);

              // notify handler_main 
              var pub = mq.context.socket('PUB', {routing: 'topic'});
              var qbody = { surge_confirmation_id : surge_confirmation_id };
              var qdata = { id : new Date().getTime(), email : email, header: 'surge', body : qbody };
              logger.info('UBER_ROUTES_SURGE: Connecting to MQ Exchange <piper.events.out>...');
              pub.connect('piper.events.out', function() {
                logger.info('UBER_ROUTES_SURGE: <piper.events.out> connected');
                pub.publish('uber.routes', JSON.stringify(qdata));
              });
            }
            cache.del(cachekey);
          });
    }
    res.render('thankyou');
    //res.redirect('slack://open');
    
  },
  products: function(req, res) {
    var lat = req.query.lat;
    var lng = req.query.lng;
    uber.getProducts(lat,lng)
      .then(function(data) {
        logger.debug('Products: %s', JSON.stringify(data));
        if (data) res.json(data);
      }).catch(function(data) {
        logger.error('Cannot process request: %s', JSON.stringify(data));
        if (data) res.json(data);
      });
  },
  timeEstimates: function(req, res) {
    var lat = req.query.lat;
    var lng = req.query.lng;
    var productId = req.query.product_id;
    uber.getTimeEstimates(lat,lng, productId
      ).then(function(data) {
        logger.debug('Time Estimates: %s', JSON.stringify(data));
        if (data) res.json(data);
      }).catch(function(data) {
          logger.error('Cannot process request: %s', JSON.stringify(data));
          if (data) res.json(data);
      });
  },
  priceEstimates: function(req, res) {
    var slat = req.query.slat;
    var slng = req.query.slng;
    var elat = req.query.elat;
    var elng = req.query.elng;
    uber.getPriceEstimates(slat,slng,elat,elng)
      .then(function(data) {
        logger.debug('Price Estimates: %s', JSON.stringify(data));
        if (data) res.json(data);
      }).catch(function(data) {
            logger.error('Cannot process request: %s', JSON.stringify(data));
            if (data) res.json(data);
      });
  }


}