# workspace-sync

[![CI][ci-badge]][ci-workflow]

[ci-badge]: https://github.com/Vessel9817/workspace-sync/actions/workflows/ci.yml/badge.svg
[ci-workflow]: https://github.com/Vessel9817/workspace-sync/actions/workflows/ci.yml

## Terminology

*Lockfile:* `package-lock.json` or `npm-shrinkwrap.json`

## Motivation

If you've ever created a set of JavaScript container images
(e.g, multiple Dockerfiles) within one repository, you've likely gone
in one of three directions:

- **Maintain separate lockfiles:**
  - Complicates installation
  - Complicates lockfile maintenance
  - May result in multiple installations of the same dependency
    - Creates bloat
    - Increases installation time relative to drive write speed
  - Simplifies image building
- **Use workspaces:**
  - Simplifies installation
  - Simplifies maintenance with one lockfile
  - No duplicate dependency installations
  - All images must use the same dependency versions
  - Bloats images with unnecessary dependencies
    - Unnecessarily increases image size
    - Increases build and download time relative to drive write speed
- **Use another package manager**

This tool was born out of a need to use npm and workspaces,
while also maintaining separate workspace lockfiles to keep image size minimal.

## Usage

### Initial setup

These steps are for absolute beginners. If you already have a project
configured with workspaces, skip to [quickstart](#quickstart)

- In your project, create a `package.json` file, preferably at the project root:

  ```shell
  cd path/to/project
  npm init -y
  ```

- Add your workspaces to `package.json`:

  ```jsonc
  {
    // ...
    "workspaces": {
      "packages": [
        "relative/path/to/workspace1",
        "relative/path/to/workspace2",
        // ...
      ]
    },
    // ...
  }
  ```

- Create each of your workspaces:

  ```sh
  mkdir -p path/to/workspace
  cd path/to/workspace
  npm init -y
  # Repeat for each workspace
  ```

- Install this tool:

  ```shell
  cd path/to/project
  npm i git+https://github.com/Vessel9817/workspace-sync.git
  ```

### Quickstart

- For each workspace, generate a lockfile:

  ```shell
  rm path/to/workspace/package-lock.json # If it already exists
  npm i --package-lock-only --workspaces false --prefix=relative/path/to/workspace
  ```

- Run this tool:

  ```shell
  npx tsx ./node_modules/workspace-sync/src/cli.ts check-all
  ```

- Manually resolve lockfile issues

## Support

Node package managers:

- [x] npm
- [ ] pnpm
- [ ] yarn

## Contributing

Please see the [contribution guidelines](./CONTRIBUTING.md)
