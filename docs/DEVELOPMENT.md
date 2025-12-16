## Development

The localhost amaran desktop websocket API looks like to be near identical or identical to the Open API Sidus has published at <https://tools.sidus.link/openapi/docs/usage> .   So if `lightControl.ts` is missing any functionality you can probably use the OpenAPI spec to implement the new functionality fairly quickly.  This cli would probably work with the Sidus desktop apps as well, as well as Windows verisons of the Amaran desktop app but I haven't tested it.  If you want to submit PRs for it, feel free!

Extending command line tool to work with their networked Open API would probably be fairly simple to do since the local Websocket API is very similar to the Open API.  

```bash
# Run in development mode
npm run dev

# Build the project
npm run build

# Clean build artifacts
npm run clean
```

## Other Files

* [API TODO](API_TODO.md)
* [CHANGELOG](CHANGELOG.md)
* [KNOWN BUGS](KNOWN_BUGS.md) 