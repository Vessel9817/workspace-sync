# Contributing Guidelines

We welcome issues or pull requests. Before opening an issue, we ask that you
first briefly look through the [open issues][issues] for any duplicate
or related issues.

## Building from source

```sh
# Clean build artifacts
rm -rf dist/
echo "$(ls -Abp | grep '.tgz$' -)" | xargs -L1 rm

# Build package
npm run build # Transpiles code
npm pack # Creates bundle compatible with `npm i`
```

[issues]: https://github.com/Vessel9817/workspace-sync/issues
