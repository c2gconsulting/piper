
var h = require('../../lib/handler');
var Log = require('log');
var redis = require('../../lib/cache');
var logger = new Log(process.env.PIPER_LOG_LEVEL || 'info');

cache = redis.getRedisClient();
cache.on("error", function (err) {
    console.log("Redis Error: " + err);
});


var run = function (body, user, client, slackCallback) {

logger.info("Processor: REQUEST_LEAVE");

    try {

        var entities = body.outcomes[0].entities; //Get the entities from WIT for the intent
        var updates = '';        
        var state = 'LEAVE_REQ';
        var leaveContextKey = state + ":" + user.name + "@" + client.slackHandle; 

        logger.info('***************************************');
        logger.info('JSON FROM WITH: ' + JSON.stringify(body));
        logger.info('***************************************');

        //Dynamically construct the json for updating the entities 

        if (body.outcomes[0].intent == 'request_leave'){ // main intent, wipe the cache

            updates = "{@leaveType,@startDate,@endDate,@duration,@genericDate,\"conversationDepth\":\"0\"}";

            updates = entities.leave_type ? updates.replace("@leaveType", "\"leaveType\": \"" + entities.leave_type[0].value + "\"") : updates.replace("@leaveType","\"leaveType\": \"\"");         
            updates = entities.start_date ? updates.replace("@startDate", "\"startDate\": \"" + entities.start_date[0].value + "\"") : updates.replace("@startDate","\"startDate\": \"\""); 
            updates = entities.end_date ? updates.replace("@endDate", "\"endDate\": \"" + entities.end_date[0].value + "\""): updates.replace("@endDate","\"endDate\": \"\""); 
            updates = entities.duration ? updates.replace("@duration", "\"duration\": \"" + entities.duration[0].normalized.value + "\""): updates.replace("@duration","\"duration\": \"\""); 
            updates = entities.generic_date ? updates.replace("@genericDate", "\"genericDate\": \"" + entities.generic_date[0].value + "\""): updates.replace("@genericDate","\"genericDate\": \"\""); 

        }else{

            updates = "{@leaveType,@startDate,@endDate,@duration,@genericDate}";

            updates = entities.leave_type ? updates.replace("@leaveType", "\"leaveType\": \"" + entities.leave_type[0].value + "\"") : updates.replace("@leaveType",'');         
            updates = entities.start_date ? updates.replace("@startDate", "\"startDate\": \"" + entities.start_date[0].value + "\"") : updates.replace("@startDate",''); 
            updates = entities.end_date ? updates.replace("@endDate", "\"endDate\": \"" + entities.end_date[0].value + "\""): updates.replace("@endDate",''); 
            updates = entities.duration ? updates.replace("@duration", "\"duration\": \"" + entities.duration[0].normalized.value + "\""): updates.replace("@duration",''); 
            updates = entities.generic_date ? updates.replace("@genericDate", "\"genericDate\": \"" + entities.generic_date[0].value + "\""): updates.replace("@genericDate",''); 


        }

        /** Clean up process **/
        // Comment out if your have less than 5 entities (add a similar line if you have 6 or more entities)
        updates = updates.replace(",,,,",",");
        // Comment out if your have less than 4  or more entities 
        updates = updates.replace(",,,",",");

        updates = updates.replace(",,",",");
        updates = updates.replace("{,","{");
        updates = updates.replace(",}","}");

        logger.info('***************************************');
        logger.info('Fields on leave context that will be updated are: ' + updates);
        logger.info('***************************************');

        //Update the stored context with any new entities that might have come from the lastest data from Wit
        cache.hmset(leaveContextKey, JSON.parse(updates), function (err, reply){

            if (err) {
                errmsg = 'Unable to process leave request';
                logger.error(errmsg + ": " + err);

                slackCallback(err, errmsg);
            }else{

                cache.hgetall(leaveContextKey, function (err, leaveContext) {
                    
                    if (err) {
                        errmsg = 'Unable to process leave request';
                        logger.error(errmsg + ": " + err);

                        slackCallback(err, errmsg);
                    }else{

                        var convoDepth = leaveContext.conversationDepth ? (parseInt(leaveContext.conversationDepth) + 1) : 1;
                        
                        //Update the conversation depth by the side.. even if it fails no issues
                        cache.hmset(leaveContextKey, { conversationDepth: convoDepth }, function(ex2, result) {
                            ex2 ? logger.error('Error updating conversation depth: ' + ex2) : logger.info('Conversation depth set to: ' + convoDepth);
                        });

                        var response = '';
                        var lastDemand = '';
                        var continueValidation = true;

                        switch(convoDepth) {
                            case 1:
                                response = "Ok, ";
                                break;
                            case 2:
                                response = "Errm... ";
                                break;
                            case 3:
                                response = "alright ";
                                break;    
                            default:
                                response = "Ok... ";
                        }

                        /*****************************************************/
                        /*    Leave Logic to Complete Missing Entities       */
                        /*****************************************************/
        
                        //Leave Type Validation
                        if ((!leaveContext.leaveType) && (continueValidation)){
                            
                            //Update last demand by the side.. even if it fails no issues
                            cache.hmset(leaveContextKey, { lastDemand: "LEAVE_TYPE" }, function(ex2, result) {
                                ex2 ? logger.error('Error updating last demand: ' + ex2) : logger.info('Last demand set to: LEAVE_TYPE');
                            });
                           
                            continueValidation = false; //prevent other validations below from happening
                            slackCallback('', response + "what type of leave?");
                        }


                        //Start Date Validation    
                        if ((!leaveContext.startDate)&& (continueValidation)){
                            
                            if ((leaveContext.genericDate) && (leaveContext.lastDemand == 'START_DATE')){ //check if start date is implied by last demand
                                leaveContext.startDate = new Date(leaveContext.genericDate);

                                //Update start date by the side.. even if it fails no issues
                                cache.hmset(leaveContextKey, { startDate: leaveContext.startDate.toISOString(), genericDate: "" }, function(ex2, result) {
                                    ex2 ? logger.error('Error updating start date: ' + ex2) : logger.info('Start date set to: ' + leaveContext.startDate);
                                });

                                leaveContext.genericDate = undefined; //reset generic date
                                continueValidation = true; //Since start date has now been sorted, lets not call back yet, rather lets proceed...
                            
                            }else if ((leaveContext.endDate) && (leaveContext.duration)){ // okay, no start date, but if duration and end date exists we can also get start date
                                leaveContext.startDate = new Date((new Date(leaveContext.endDate)).getTime() - (leaveContext.duration * 1000));

                                cache.hmset(leaveContextKey, { startDate: leaveContext.startDate.toISOString()}, function(ex2, result) {
                                    ex2 ? logger.error('Error updating start date: ' + ex2) : logger.info('Start date set to: ' + leaveContext.startDate);
                                });

                                continueValidation = true; //Since start date has now been sorted, lets not call back yet, rather lets proceed...

                            }else{
                                //Update last demand by the side.. even if  it fails no issues
                                cache.hmset(leaveContextKey, { lastDemand: "START_DATE" }, function(ex2, result) {
                                    ex2 ? logger.error('Error updating last demand: ' + ex2) : logger.info('Last demand set to: START_DATE');
                                });

                                continueValidation = false; //prevent other validations below from happening
                                slackCallback('', response + "when are you leaving?");
                            }

                        }

                         //End date Validation
                        if ((!leaveContext.endDate)&& (continueValidation)){

                            //User might have given a generic answer like "tomorrow", that cannot be easily mapped to start date or end date
                            if ((leaveContext.genericDate) && (leaveContext.lastDemand == 'END_DATE')){ 
                                leaveContext.endDate = new Date(leaveContext.genericDate);

                                //Update end date by the side.. even if it fails no issues
                                cache.hmset(leaveContextKey, { endDate: leaveContext.endDate.toISOString(), genericDate: "" }, function(ex2, result) {
                                    ex2 ? logger.error('Error updating end date: ' + ex2) : logger.info('End date set to: ' + leaveContext.endDate);
                                });

                                leaveContext.genericDate = undefined; //reset generic date
                                continueValidation = true; //Since end date has now been sorted, lets not call back yet, rather lets proceed...
                            }else if ((leaveContext.startDate) && (leaveContext.duration)){ // okay, no end date, but if duration and start date exists we can also get end date
                                leaveContext.endDate = new Date((new Date(leaveContext.startDate)).getTime() + (leaveContext.duration * 1000));
                                 
                                // logger.info('Duration in Days: ' + leaveContext.endDate);   
                                ///Update end date by the side.. even if it fails no issues
                                cache.hmset(leaveContextKey, { endDate: leaveContext.endDate.toISOString()}, function(ex2, result) {
                                    ex2 ? logger.error('Error updating end date: ' + ex2) : logger.info('End date set to: ' + leaveContext.endDate);
                                });

                                continueValidation = true; //Since start date has now been sorted, lets not call back yet, rather lets proceed...

                            }else{
                                //Update last demand by the side.. even if it fails no issues
                                cache.hmset(leaveContextKey, { lastDemand: "END_DATE" }, function(ex2, result) {
                                    ex2 ? logger.error('Error updating last demand: ' + ex2) : logger.info('Last demand set to: END_DATE');
                                });

                                continueValidation = false; //prevent other validations below from happening
                                slackCallback('', response + "when are you back?");
                            }
                        }

                       

                        if (continueValidation){
                            logger.info('***************************************');
                            logger.info('FINAL LEAVE CONTEXT: ' + JSON.stringify(leaveContext));
                            logger.info('***************************************');
                            
                            slackCallback('', "Ok...y lets see if we can create a " + leaveContext.leaveType + " leave starting on " + leaveContext.startDate + " and ending on " + leaveContext.endDate);

                            /*
                            h.getHandler(client.slackHandle, state, function (ex3, handler){
                                if (ex3) {
                                    errmsg = 'Im sorry but a problem occurred... ';
                                    logger.error(errmsg + "Details: " + ex3);
                                    slackCallback(err, errmsg);
                                } else {
                                    logger.info("Handler obtained ");

                                }
                            });
                            */
                        }
                        
                    }
                });
                
            }

        });     
       
    } catch (e) {      
        errmsg = 'Unable to process leave request';
        logger.error(errmsg + ": " + e.stack);

        slackCallback(e, errmsg);
    }
   
}

module.exports.run = run;

