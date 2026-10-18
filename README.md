# QSOS - Qualification and Selection of Open Source Software

QSOS is a method designed to qualify, select and compare Open Source software in an objective, traceable and argumentative way.

## Documentation

The documentation content is stored in the `docs/content/` folder. The dedicated documentation site is built with Docus.

**To run the docs site:**
```bash
# From project root

# npm
npm run docs:dev

# pnpm
pnpm run docs:dev

# bun
bun run docs:dev
```

**To build the docs:**
```bash

# npm
npm run docs:build

# pnpm
pnpm run docs:build

# bun
bun run docs:build
```

### Viewing Documentation

- **Integrated**: Start the main app (`bun run dev`) and navigate to `http://localhost:3000/docs`
- **Standalone**: Run `bun run docs:dev` and navigate to the provided URL (typically `http://localhost:3001`)

## Quick Start

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# bun
bun run dev
```

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.


## Roles.json 
- the data/roles.json file which lists the administrators' email addresses

Example code : 
```
{
  "emails": [
    "admin@qsos.org",
    "tester@qsos.org"
  ]
}
```

## file .env : 
- the .env file containing the secrets and authentication keys

Example: 

```
# As nuxt-auth-utils uses sealed cookies to store session data, 
# session cookies are encrypted using a secret key from 
# the NUXT_SESSION_PASSWORD environment variable.
NUXT_SESSION_PASSWORD=password-with-at-least-32-characters

# OAuth Providers secrets - replace with your own credentials to enable authentication with GitHub and GitLab
NUXT_OAUTH_GITHUB_CLIENT_ID=your-github-client-id
NUXT_OAUTH_GITHUB_CLIENT_SECRET=your-github-client-secret
NUXT_OAUTH_GITLAB_CLIENT_ID=your-gitlab-client-id
NUXT_OAUTH_GITLAB_CLIENT_SECRET=your-gitlab-client-secret

# Documentation Server
# Port where your documentation server is running
DOCS_SERVER_PORT=3001
```

## Contributing

Contributions are made through GitHub pull requests. Before contributing:

- sign the [Eclipse Contributor Agreement (ECA)](https://www.eclipse.org/legal/ECA.php) with the email address you use in your commits;
- sign off every commit (`git commit -s`).

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

This repository (code) is licensed under the [Apache License 2.0](LICENCE).

The QSOS method itself is published under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

## Trademarks

Eclipse QSOS and the QSOS logo are trademarks of Eclipse Foundation AISBL.
