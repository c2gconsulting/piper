var express = require('express');
var router = express.Router();
var calEvent = require('./lib/calendar');
var cache = require('../shared/lib/cache').getRedisClient();
var logger = require('../shared/lib/log');
//define routes
//define root
router.get('/', function(req, res){
    res.end('<H1>Welcome to C2G PIPER Google Calendar HANDLER</H1>');
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

// url for google calendar push notification;
router.post('/incode', function(req,res){
    var code = req.body.code;
    var user = req.body.user;
    var client = req.body.client;
    logger.debug('code : %s user: %s client: %s', code, user,client);
    //save token in credentials and then save ... send direct message to user in slack
    // validate code
    if(code && user && client){
        calEvent.validateCode(user, client, code)
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