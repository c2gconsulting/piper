var express = require('express');
var router = express.Router();
var calEvent = require('./lib/gapps');
var cache = require('../shared/lib/cache').getRedisClient();
var logger = require('../shared/lib/log');
var base64 = require('js-base64').Base64;
var mq = require('../shared/lib/mq');
//define routes
//define root
router.get('/', function(req, res){
    res.render('pages/index', {id: null});
});

router.get('/events', function(req, res){
    //set username for events
    var user = req.query.username;
    var client = req.query.client;
    var data = {user: user, client: client };
    if(user && client) calEvent.authorize(data, function(auth, url){
        if(url){
            res.end(url);
        }
        if(auth){
            console.log('the auth received is' + JSON.stringify(auth));
            calEvent.getEvents(auth)
                .then(function(events){
                    console.log('This was called expecting events');
                    res.end(JSON.stringify(events));
                }, function(err){
                    console.log('This error was called' + err);
                    res.end(JSON.stringify(err));
                }
            );
        }

    })
});

router.get('/readmail', function(req, res){
    //set username for events
    var user = req.query.username;
    var client = req.query.client;
    var data = {user: user, client: client };
    if(user && client) calEvent.authorize(data, function(auth, url){
        if(url){
            res.end(url);
        }
        if(auth){
            console.log('the auth received is' + JSON.stringify(auth));
            calEvent.getMailList(auth)
                .then(function(mails){
                    console.log('This was called expecting mails');
                    // get the full body of the first item in the list
                    if (mails['messages'].length > 0){
                        logger.info('Message length > 0');

                        calEvent.readMail(auth, mails['messages'][0].id)
                            .then(function(result){
                                // check if result has a property of payload
                                var body;
                                if(result.hasOwnProperty('payload')){
                                    body = result.payload.parts[0].parts[0].body.data;
                                } else {
                                    body = ""
                                }
                                 //var body = result['payload']['body']['data'];
                                 //logger.debug(body);
                                 //bodydata = base64.decode(body.replace(/-/g, '+').replace(/_/g, '/'));
                                res.end(JSON.stringify(result));
                            }, function(err){
                                res.end(JSON.stringify(err));
                            });
                    }
                }, function(err){
                    console.log('This error was called');
                    res.end(JSON.stringify(err));
                }
            );
        }

    })
});


router.get('/calendar', function(req, res){
    res.render('/pages/index');
});

router.get('/auth', function(req, res){
    var id = req.query.id;
    //get details
    if(id) {
        cache.hgetall(id, function(e, r){
            if(r) {
                console.log(JSON.stringify(r));
                res.render('pages/auth', {auth: r, title: 'Piper Google Authentication'})
            } else {
                res.render('pages/auth', {auth: null})
            }
        });
    } // else send error code 400;

});

router.get('/oauth2callback', function(req, res){
    //
    var code = req.query.code;
    var state = req.query.state;
    if (code && state){
        var uk = state.split("@");
        if (uk.length > 1) {
            var user = uk[0], client = uk[1];
            calEvent.valCode(code, user, client)
                .then(function (auth) {
                    //send a message to the user confirming his/her succesful authorisation
                    // notify handler_main
                    var pub = mq.context.socket('PUB', {routing: 'topic'});
                    //get users last message
                    var userkey = 'calendar_events:' + user + '@' + client + ':lastMessage';
                    cache.hget(userkey, 'data')
                        .then(function(data){
                            var qbody = data;
                            var qdata = {id: new Date().getTime(), user: user, client: client, header: 'auth', body: qbody};
                            if(data) qdata['process'] = true;
                            cache.hdel(userkey, 'data');

                            logger.info('Google Calendar: Connecting to MQ Exchange <piper.events.out>...');
                            pub.connect('piper.events.out', function () {
                                logger.info('Google Calendar : <piper.events.out> connected');
                                pub.publish('calendar.auth', JSON.stringify(qdata));
                            });
                        })


                    res.render('pages/success', {title: 'Piper Access grant Successful'})
                }, function (err) {
                    res.render('pages/error', {title: 'Unsuccessful Authorization', error: err});
                })
        }
    }
});

// url for google calendar push notification;
router.post('/incode', function(req,res){
    var code = req.body.code;
    var user = req.body.user;
    var client = req.body.client;
    logger.debug('code : %s user: %s client: %s', code, user,client);
    //save token in credentials and then save ... send direct message to user in slack
    // validate code
    if(code && user && client){
        calEvent.validateCode(user, clieoauth2callbacknt, code)
            .then(function(token){
                // success
                res.render('pages/confirmation', {title: 'Succesful Authorization', data: true })
            }, function(err){
            res.render('pages/confirmation', { title: 'Unsuccessful Authorization', data: false} );
        })
    } else {
        res.render('pages/confirmation', {title: 'Unsuccessful Authorization', data: false });
    }


});
module.exports = router;