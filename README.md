# hackprinceton2026_restaurantOS

See [Repository structure](STRUCTURE.md) for the Tactical and Expansion code maps.

Deploy both modules on one Vultr VM using the [deployment guide](docs/DEPLOYMENT_VULTR.md). The container includes the Next.js app and Expansion's Python worker, with HTTPS and persistent storage configured separately from runtime secrets.

Expansion is available at `/expansion`: scout the fictional Houston market, compare opening scenarios, and save them in this browser. See [Expansion implementation notes](docs/expansion/IMPLEMENTATION.md) for data boundaries and verification. The default route opens the Sprout welcome page; Tactical is available at `/tactical`.
