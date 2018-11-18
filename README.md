#### Epload

We release our tool, **Epload** (short for **e**mulating **p**age
**load**), that emulates the page load process for folks who are only
interested in running network experiments while hoping to preserve
authenticity of the page load process. Epload is built on top of
[WProf]. Compared to browsers, Epload provides the following benefits.

-   Epload performs deterministically in computation so as to save lots
    of repeated experiments. Without Epload, lots of repeated
    experiments are required to statistically reduce the impact of
    variability in computation.
-   Epload made it easy to play with advanced SPDY mechanisms
    (prioritization and server push).

Epload works as follows. It first records the dependency graph of a Web
page while loading the page using our [WProf][1] tool. Then, it converts
the logs output from the WProf tool to the dependency graph in the JSON
format. Next, Epload replays the dependency graph. It walks through the
dependency graph from the first activity, that is loading the root HTML.
When it encounters a network activity, it makes request to the
corresponding URL; when it encounters a computation activity, it waits
for the same amount of time that computation takes (informed by the
dependency graph). Every time when it completes an activity, it checks
whether it should trigger dependent activities based on whether all
activities that a dependent activity depends on are finished. It keeps
walking through the dependency graph this way until all activities in
the dependency graph have been visited.

Below, we focus on the replaying process of Epload. We provide hundreds
of dependency graphs that we recorded (on a 2GHz Mac) to get started
with. To record dependency graphs on your own, please refer to the
[WProf][1] page and read the \"Dependency graph\" section below.

------------------------------------------------------------------------

##### Download

[Epload source code] (42.8KB; written based on [node.js]). Be sure to
download and install node.js before running Epload. Our code depends on
a node.js module, [SPDY], which is a SPDY server. Be sure to install it
(`npm spdy`) before running Epload.

------------------------------------------------------------------------

##### Usage

The Epload code is under `epload/emulator/`; the HTTP client is under
`epload/client_http/`; and the SPDY client is under
`epload/client_spdy/` which is implemented based on the SPDY/3 spec. As
an experimental tool, the SPDY client does not include the protocol
negotiation phase. To run the code, enter the Epload directory:

    $ cd epload/emulator

Then, run the code

    $ node run.js [protocol] [dependency graphs]

`[protocol]` is either `http` or `spdy`. `[dependency graphs]` is the
directory that stores the dependency graphs of Web page loads. Epload
will sequetially emulates Web page loads of which the dependency graphs
are stored in this directory. To test out Epload on your machine, type
`node run.js http tests`. If you are able to see messages like `=====
[loaded the i-th page] timestamp`, it means that Epload works correctly.

<div class="alert">

Note that running `node run.js spdy tests` won't work, since our test
server only enables HTTP, not SPDY. It requires rewriting hosts (to ones
on which SPDY is enabled) in \*.json files to test SPDY.

</div>

Epload allows simple configurations to test out domain sharding,
prioritization and server push strategies, and hypothetically varied
computation. This is done by configuring the `options` variable in file
`run.js`.

To enable or disable HTTPS: open emulator/emulator.js, change the structure
client\_options from:

    https: false

to:

    https: true


###### Domain sharding

`domain_sharding_type` in the `options` variable configures the type of
domain sharding to use.

  - `0` No domain sharding (a single TCP connection is used to fetch all
    the objects of a Web page).
  - `1` Domain sharding by full domain (one TCP connection per full
    domain).
  - `2` Domain sharding by top-level domain (one TCP connection per
    top-level domain).

###### Prioritization

`priority_type` in the `options` variable configures the type of
prioritization strategies to use.

  - `0` No prioritization.
  - `1` Chrome's prioritization strategy (HTML \> JS, CSS \> others).
  - `2` Our prioritization strategy (Prioritizing by depth in a
    dependency graph). When this prioritization strategy is used, the
    max and min of priority levels need to be configured.
    `priority_lmax` represents the highest priority (no less than zero);
    `priority_lmin` represents the lowest priority (no more than seven).
    `priority_lmax` should be no more than `priority_lmin`.
    
###### Server Push

`server_push_type` in the `options` variable configures the type of
server push to use.

  - `0` No server push.
  - `1` Push everything.
  - `2` Push by depth in a dependency graph (used by us). When this
    server push strategy is used, `server_push_depth` that represents
    the depth to push needs to be configured. We find that pushing depth
    1 is good in balancing latency and pushed bytes.
  - `3` Push by embedding level (used in mod\_spdy).

###### Varying Computation

`alpha` and `beta` in the `options` variable configure the length of
each computation activity relative to the captured length. A computation
activity (e.g., evaluating a JavaScript) will take `alpha` \*
original\_time + `beta` amount of time where original\_time is the
captured time that this activity spent. `alpha : 0.5`, for example,
means that CPU speed is doubled.

-----

##### Dependency graph

To get started with Epload, we provide a few dependency graphs that we
recorded. Below, we show steps to set up the dependency graphs and
experiments.

1.  Have a client and a Web server at hands.
2.  Download [Web objects](server.tar.gz) (277MB) to the Web server.
3.  Download the [dependency graphs](dependency_graphs.tar.gz) (787KB)
    that will be used to load the Web objects and put them in a
    directory on the client.
4.  Rewrite URLs (`host` and `path`) in the dependency graphs and point
    them to the path that serves Web objects on the server. `host` and
    `path` are fields of each child of the `"objs"` field in the
    dependency graphs.
5.  Run Epload with HTTP to check whether rewrites are done correctly.
    For example, `node run.js http path_to_graphs/58.com_/` and look for
    messages like `===== [loaded the i-th page] timestamp`
6.  Install a SPDY server on the Web server. We recommend to use
    [mod\_spdy](https://code.google.com/p/mod-spdy/). If mod\_spdy is
    used, be sure to enable no-ssl SPDY by adding
    `SpdyDebugUseSpdyForNonSslConnections 3` to the `spdy.conf` file
    under Apache's mods-available directory. If other SPDY server is
    used, be sure to configure accordingly to use no-ssl SPDY and
    SPDY/3.
7.  Run Epload with SPDY to check whether SPDY is properly set up. For
    example, `node run.js spdy path_to_graphs/58.com_/` and look for
    messages like `===== [loaded the i-th page] timestamp`
8.  To measure page load times, either look for `=== [page load time]
    timestamp` (in milliseconds) messages, or time the run of Epload
    when initiating Epload using another script.
    
###### JSON fields

Let's go through the fields in the json file that represents a
dependency graph.

  - `objs` Array of Web objects. Each element in the array has the
    following fields.
      - `id` Id of this Web object.
      - `host` Domain of the Web server that hosts this Web object.
      - `path` Path on the Web server that this Web object is served.
      - `when_comp_start` Indicates when computation starts relative to
        when this Web object is loaded. `when_comp_start : 1` means that
        the first computation activity starts after *the first chunk* of
        the object is loaded. `when_comp_start : -1` means that the
        first computation activity starts after *the whole* object is
        loaded.
      - `download` Object of the download activity of the Web object.
          - `id` Id of the download activity.
          - `type` Type of the download activity. It is always
            `download` here.
      - `comps` Array of computation activities of the Web object. Each
        element in the array has the following fields.
          - `id` Id of the computation activity.
          - `type` Type of the computation activity. It represents one
            of parsing HTML, evaluating JavaScript or CSS.
          - `Time` Time in milliseconds that the computation activity
            takes.
  - `deps` Array of dependencies between pairs of Web objects. Each
    element in the array has the following fields.
      - `id` Id of the dependency. Activity `a2` depends on activity
        `a1`.
      - `a1` Id of the depended activity.
      - `a2` Id of the dependent activity.
      - `time` Indicates when `a2` can be triggered. `time : -1` means
        that `a2` cannot start until `a1` is completed; otherwise it
        means that `a2` cannot start until `time` milliseconds after
        `a1` started.
  - `start_activity` The id of first activity to start with (i.e.,
    downloading the root HTML).

###### Generating dependency graphs from WProf

Dependency graphs can also be generated from our WProf tool. First,
follow the instructions on the
[WProf](http://wprof.cs.washington.edu/tool/) page and make sure your
Chromium can output WProf logs. Second, [send us an
email](mailto:wangxiao@cs.washington.edu) asking for the analysis code
to generate dependency graphs from the WProf logs. The analysis code is
beta and we will release it in the future.
