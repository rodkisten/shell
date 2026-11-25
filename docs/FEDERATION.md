# Code federation

Workflow Studio now exports a standalone React component independently of its DOM bootstrap. The future federation entry is `src/remote.tsx`. Host contracts live in `@code/contracts`. The existing Cloudflare Shell deployment is unchanged. The next step is installing and locking the Vite federation plugin, configuring the remote manifest, and validating a real host build.
