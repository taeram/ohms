Ohms
====

Ohms is an SMS based API for Couch Potato and Sick Beard.

Requirements
============

You'll need the following:

* [Node.js](http://nodejs.org/) installed
* [Ruby](https://www.ruby-lang.org/) installed
* A working installation of [CouchPotato](https://couchpota.to/) and [SickBeard](http://sickbeard.com/)
* A [Twilio](http://www.twilio.com/) account 

Setup
=====

If you don't have a Twilio number, purchase one now. Then, Edit your number and change the SMS Request URL to POST to `http://[your-server-ip-address]:3000/`

Next, install and setup Ohms on your server:
```bash
    # Clone the repo
    git clone https://github.com/taeram/ohms.git
    cd ./ohms

    # Install the packages
    npm install

    # Setup your Environment variables
    tee .env << EOF
    FROM_NUMBER="+12345556789"        # Your Twilio number
    CONTROL_NUMBER="+12345556889"     # The mobile number that is allowed to send commands to the SMS API
    TWILIO_SID="SID"                  # Your Twilio SID
    TWILIO_AUTH_TOKEN="AUTH_TOKEN"    # Your Twilio Auth Token
    COUCHPOTATO_API_KEY="API_KEY"     # Your CouchPotato API Key
    SICKBEARD_API_KEY="API_KEY"       # Your SickBeard API Key
    EOF

    # Install foreman and setup the init scripts
    gem install foreman
    sudo foreman export upstart /etc/init --concurrency web=1,web-debug=0 --app ohms --user root --log /var/log/

    # Start all the things
    sudo start ohms
```

Commands
========

When you have everything setup, simply send one of the following commands to your Twilio number.

Movies
* m search [movie-name]
* m add [movie-id]

Eg.

    m search escape from new york

    > 1. Escape from New York (1981)
    > 2. Escape from New York (2013)

    m add 1

    > "Escape from New York (1981)" added to wanted list

TV
* tv search [tv-series-name]
* tv add [tv-series-id]

Eg.

    tv search futurama

    > 1. Futurama (1999)

    tv add 1

    > "Futurama (1999)" added!
