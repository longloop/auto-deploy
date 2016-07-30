var app = require('express')();
var http = require('http').Server(app);
var mongoose = require('mongoose');

var _globals = require('./_globals.js');

mongoose.connect('mongodb://localhost/'+_globals.dbname);
Users = require('./models/users');
Pulls = require('./models/pulls');

app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');

app.get('/', function (req, res) {
   res.render('detailgather');
});

var _username = "";
app.get('/forwardtoauth', function (req, res) {
    _username = req.query.username;
    User = Users;
    User.findUser(_username, function(done){
        if(done.status)
        {
            res.redirect(/chooserepo/+done.token);
        }
        else
        {
            User.newUser(_username, function(done) {
                if(!done.status){
                    res.send("Please retry");
                }
                else{
                    res.redirect("https://github.com/login/oauth/authorize?client_id=" + _globals.client_id + "&scope=repo&redirect_uri=" + _globals.webhook_callback_url + "/gettoken");
                }
            });
        }
    })
});

app.get('/gettoken', function (req, res) {
var request = require('request');
    request.post(
        'https://github.com/login/oauth/access_token',
        { json: { code: req.query.code, client_id:_globals.client_id , client_secret:_globals.client_secret} },
        function (error, response, body) {
            //console.log(response);
            if (!error && response.statusCode == 200) {
                console.log(body)
                if(body.scope == 'repo') {
                    var token = body.access_token;
                    User = Users;
                    User.addTokenToUser(_username, token, function(done){
                        console.log("saved token :",done.status);
                    })
                    res.redirect(/chooserepo/+token);
                }
                else {
                     res.send("Did you mess with the request?");
                }
            }
        }
    );
});

app.get('/chooserepo/:token', function (req, res) {
    if(req.params.token != undefined || req.params.token != null)
    {
        getRepos(req.params.token, 1, [], function(repolist){
            res.render('repolist',{repolist:repolist, token:req.params.token});
        });
    }
    else
    {
        res.send("No Direct access");
    }
});

app.get('/choosebranch/:reponame/:owner/:token', function(req, res){
    //res.send(req.params.reponame);
    getBranches(req.params.token, req.params.reponame, req.params.owner , 1, [], function(branchlist){
        res.render('branchlist',{branchlist:branchlist, token:req.params.token, reponame:req.params.reponame, owner:req.params.owner});
    });
});

app.get('/addwebhook/:owner/:reponame/:branch/:token', function(req, res){
    var owner = req.params.owner,
        reponame = req.params.reponame,
        branch = req.params.branch,
        token = req.params.token;
    
    createHookonRepo(owner, reponame, branch, token , function(resl){
        var hookid = resl.id;
        Pull = Pulls;
        Pull.newPull(hookid, reponame, branch,serverip,serveruser,serverpass,serverpath,command, function(done){
            if(done.status)
                res.send(resl);
            else
                {
                    deleteHookId(owner, reponame, hookid , token, function(result){
                        res.send("Opps try again.")
                    });
                }
        });
    });
});

app.get('/pullrepo/:reponame/:branch', function(req, res){
    //to the server of reponame and pull it
    //SSH unit
    //var SSH = require('simple-ssh');
    // 
    //var ssh = new SSH({
    //    host: _globals.ssh_host,
    //    user: _globals.ssh_user,
    //    pass: _globals.ssh_pass
    //});
    // 
    //ssh.exec('pwd', {
    //    out: function(stdout) {
    //        console.log(stdout);
    //    },
    //    err: function(stderr) {
    //        console.log(stderr); // this-does-not-exist: command not found 
    //    }
    //}).start();
});

function getRepos(token, page, repolist, callback){
    var GitHubApi = require("github");

    var github = new GitHubApi({
        // optional
        debug: true,
        protocol: "https",
        host: "api.github.com", // should be api.github.com for GitHub
        pathPrefix: "", // for some GHEs; none for GitHub
        timeout: 5000,
        headers: {
            "user-agent": "auto-deploy" // GitHub is happy with a unique user agent
        },
        followRedirects: false, // default: true; there's currently an issue with non-get redirects, so allow ability to disable follow-redirects
    });

    github.authenticate({
        type: "oauth",
        token: token
    });
    
    github.repos.getAll({per_page:10, page:page}, function (err, resl){
        //console.log(JSON.stringify("one fetch = ",resl));
        packRepos(resl);
        if (github.hasNextPage(resl)) {
            getRepos(token, ++page, repolist, callback);
        }
        else
            packRepos(null);
        function packRepos(resl)
        {
            if(resl == null) {
                console.log(JSON.stringify(repolist));
                callback(repolist);
            }
            else
            {
                resl.forEach(function (v,i) {
                  repolist.push({name: v.name, owner: v.owner.login, fullname:v.full_name});
                });
            }
        }
    });
}

function getBranches(token, repo, user, page, branchlist, callback){
    var GitHubApi = require("github");

    var github = new GitHubApi({
        // optional
        debug: true,
        protocol: "https",
        host: "api.github.com", // should be api.github.com for GitHub
        pathPrefix: "", // for some GHEs; none for GitHub
        timeout: 5000,
        headers: {
            "user-agent": "auto-deploy" // GitHub is happy with a unique user agent
        },
        followRedirects: false, // default: true; there's currently an issue with non-get redirects, so allow ability to disable follow-redirects
    });

    github.authenticate({
        type: "oauth",
        token: token
    });
    
    github.repos.getBranches({user: user, repo:repo, per_page:10, page:page}, function (err, resl){
        //console.log(JSON.stringify(resl));
        packBranches(resl);
        if (github.hasNextPage(resl)) {
            getBranches(token, ++page, branchlist, callback);
        }
        else
            packBranches(null);
        function packBranches(resl)
        {
            if(resl == null) {
                console.log(JSON.stringify(branchlist));
                callback(branchlist);
            }
            else
            {
                resl.forEach(function (v,i) {
                  branchlist.push({name: v.name});
                });
            }
        }
    });
}

function createHookonRepo(username, reponame, branch , token, callback){
    var GitHubApi = require("github");

    var github = new GitHubApi({
        // optional
        debug: true,
        protocol: "https",
        host: "api.github.com", // should be api.github.com for GitHub
        pathPrefix: "", // for some GHEs; none for GitHub
        timeout: 5000,
        headers: {
            "user-agent": "auto-deploy" // GitHub is happy with a unique user agent
        },
        followRedirects: false, // default: true; there's currently an issue with non-get redirects, so allow ability to disable follow-redirects
    });

    github.authenticate({
        type: "oauth",
        token: token
    });

    github.repos.createHook({ 
        user: username,
        repo :reponame,
        name : "web",
        config	: {
            url : _globals.webhook_callback_url+'/pullrepo/'+reponame+'/'+branch
        }
    }, function(err,resl){
        console.log(JSON.stringify(resl));
        callback(resl);
    });
}

function deleteHookId(username, reponame, id , token, callback){
    var GitHubApi = require("github");

    var github = new GitHubApi({
        // optional
        debug: true,
        protocol: "https",
        host: "api.github.com", // should be api.github.com for GitHub
        pathPrefix: "", // for some GHEs; none for GitHub
        timeout: 5000,
        headers: {
            "user-agent": "auto-deploy" // GitHub is happy with a unique user agent
        },
        followRedirects: false, // default: true; there's currently an issue with non-get redirects, so allow ability to disable follow-redirects
    });

    github.authenticate({
        type: "oauth",
        token: token
    });

    github.repos.deleteHook({ 
        user: username,
        repo :reponame,
        id : id,
    }, function(err,resl){
        console.log(JSON.stringify(resl));
        callback(resl);
    });
}

http.listen(_globals.app_port, function () {
    console.log('listening on *:'+_globals.app_port);
});
