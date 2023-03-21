## Local cluster service for Kapeta

This service is a multi-functional service for simulating a "real" cluster - specifically during
local development.

### Features

#### Configuration Service
Provides configuration management for local services to simplify configuring local instances and
also auto-generates configuration as part of its service discovery and routing capabilities.

#### Service Discovery
Also provides simple service-discovery through its control over configuration - by simply controlling
where services find other services. This is also how it injects itself as a MITM proxy for all local 
traffic and how we intend to achieve "local -> remote" and "remote -> local" tunneling in the future.  

#### Local Proxy
The service also provides a local proxy server that enables fine-grained routing and traffic-inspection.
The only protocol currently supported is HTTP and REST-JSON but the intention is to add support for 
several others such as MySQL, PostgreSQL, MongoDB, Redis and more.  

#### Local Metrics (Not implemented)
The local cluster service should also support metrics reporting from the 
local instances to make testing and checking metrics for your local environment straight-forward.

#### Remote Tunnel (Not implemented)
It's able to connect to a remote cluster and override certain endpoints conditionally in that cluster to
make them point to itself.

This is to allow these scenarios:
- Testing in production for a subset of users (Or just your own)
- Development against a team or private sandbox to avoid running every service locally 
