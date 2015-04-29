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
    # Your Twilio number
    FROM_NUMBER=+12345556789

    # The mobile number that is allowed to send commands to the SMS API
    CONTROL_NUMBER=+12345556889

    # Your Twilio SID
    TWILIO_SID=abcdef

    # Your Twilio Auth Token
    TWILIO_AUTH_TOKEN=abcdef

    # The Couchpotato details
    COUCHPOTATO_HOST=localhost
    COUCHPOTATO_API_KEY=abcdef

    # The Sickbeard details
    SICKBEARD_HOST=localhost
    SICKBEARD_API_KEY=abcdef

    # The port to run Ohms on
    PORT=6257

    # If set to "1", allow running Ohms behind a proxy (e.g. Apache, Nginx)
    TRUST_PROXY=1

    # If running behind a proxy, you'll also need to set this to the same as your Messaging Request URL in Twilio
    WEBHOOK_URL=http://example.com
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
