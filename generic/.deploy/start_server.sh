#!/bin/bash

#Doing this as a service is probably the neater approach, this has been configured in /etc/init.d/piper-api 
#There are issues around it working on another user except root, so for now we will put the forever start and stop script directly here. 


#check of service is running first
running=$(ps aux | grep piper-api | grep -v grep | awk '{print $2}')

if [[ -z "$running" ]]; then
        #serice is not running start
        echo $"Piper wasnt running, starting service.."
        
        export PORT=3001
        forever start -a -w -p /var/log/forever/piper-generic-handler --uid "piper-generic-handler" -l /var/log/forever/piper-generic-handler/forever.log -o /var/log/forever/piper-generic-handler/out.log -e /var/log/forever/piper-generic-handler/err.log --sourceDir=/var/deploy/piper-generic-handler server.js
        
        #service piper-api start
else
        #service is running kill it first and start    
        #echo $"Piper already running, will kill and restart service..."

        #service piper-api stop
        #sleep 2s
        #service piper-api start

        echo $"piper-generic-handler already running file additions will be detected and service restarted because of the -w option"
fi

unset running
