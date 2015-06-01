var ContextIO = require('contextio');
var credentials = require('../../shared/config/contextio.json');
var ctxioClient = new ContextIO.Client({
    key: credentials.key,
    secret: credentials.secret
});