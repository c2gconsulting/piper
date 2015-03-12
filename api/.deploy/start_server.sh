#!/bin/bash

#Doing this as a service is probably the neater approach, this has been configured in /etc/init.d/piper-api 
#There are issues around it working on another user except root, so for now we will put the forever start and stop script directly here. 


#check of service is running first
nodejs=$(pgrep nodejs)

if [[ -z "$nodejs" ]]; then
        #serice is not running start
        echo $"Piper wasnt running, starting service.."
        
        export PORT=80
        forever start -a -w -p /var/log/forever --uid "piper-api" -l /var/log/forever/forever.log -o /var/log/forever/out.log -e /var/log/forever/err.log --sourceDir=/var/deploy/piper-api server.js
        
        #service piper-api start
else
        #service is running kill it first and start    
        #echo $"Piper already running, will kill and restart service..."

        #service piper-api stop
        #sleep 2s
        #service piper-api start

        echo $"Piper already running file additions will be detected and service restarted because of the -m option"
fi

unset nodejs
