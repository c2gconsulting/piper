var fs = require('fs');
var path = require('path');
var winston = require("winston");
var config = require("../config/log.json");
winston.emitErrs = true;

var logfile = (config.logenv === 'production' ? config.logfile : path.join(__dirname, '..', 'tmp', 'piper.log'));

// create log file if not existing
fs.closeSync(fs.openSync(logfile, 'a'));
    
var logger = new (winston.Logger)({
    transports: [
      new winston.transports.Console({
      	level: 'debug',
        handleExceptions: true,
        json: false,
        colorize: true
      }),
      new winston.transports.File({ 
      	level: 'info',
        filename: logfile,
        handleExceptions: true,
        json: true,
        maxsize: 5242880, //5MB
        maxFiles: 5,
        colorize: false
      })
    ],
    exceptionHandlers: [
      new winston.transports.File({ filename: logfile })
    ],
    exitOnError: false
});


/*
var Log = require('log')
  , fs = require('fs')
  , stream = fs.createWriteStream(config.logFile, { flags: 'a' })
  , logger = new Log('debug', stream);*/

module.exports = logger;
module.exports.stream = {
    write: function(message, encoding){
        logger.info(message);
    }
};