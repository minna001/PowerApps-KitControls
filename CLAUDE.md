# Power Apps workspace

This repo is used to build Power Apps (model-driven, canvas, code apps) and their
components from the command line with the Power Platform CLI (`pac`).

## Toolchain

`scripts/setup-toolchain.sh` installs everything on Ubuntu: .NET SDK 8 and 10, and
`pac` (Microsoft.PowerApps.CLI.Tool, needs .NET 10). Node 22 and npm are assumed.
If `pac` is missing, run that script before anything else.

## Layout

- `src/` — six legacy PCF controls from the original KitControls project (2019,
  `pcf-scripts` 0.3.x). They do not build on current Node. Do not touch them
  unless asked; migrating one means re-scaffolding with `pac pcf init` and
  porting the control's `index.ts` and manifest.
- `apps/` — new work goes here, one folder per app or component:
  - `apps/<name>/control/` PCF control
  - `apps/<name>/plugin/` Dataverse plug-in (C#)
  - `apps/<name>/solution/` solution project that packages the above
  - `apps/<name>/canvas/` unpacked canvas app source
  - `apps/<name>/codeapp/` code app (React + Vite)

## Works offline (verified in this container)

```bash
# PCF control (field or dataset; --framework react for Fluent/React virtual controls)
pac pcf init --namespace <Ns> --name <Name> --template field --framework react --run-npm-install
npm run build            # type-checks and bundles
npm start watch          # local test harness on a dev port

# Solution that packages one or more controls/plug-ins into an importable zip
pac solution init --publisher-name <publisher> --publisher-prefix <prefix>
pac solution add-reference --path ../control
dotnet build -c Release  # -> bin/Release/<solution>.zip

# Dataverse plug-in
pac plugin init --skip-signing && dotnet build
```

## Needs a signed-in Power Platform environment

None of this has been exercised yet; it needs a tenant, an auth profile, and
network access to the Microsoft hosts below.

```bash
pac auth create --deviceCode --environment https://<org>.crm.dynamics.com
pac auth create --applicationId <id> --clientSecret <secret> --tenant <tenant> \
  --environment https://<org>.crm.dynamics.com --accept-cleartext-caching   # service principal
pac env who

# Model-driven: pull a solution to source, edit XML, push it back
pac solution clone --name <SolutionName>          # or: export + unpack
pac solution pack --zipfile out.zip --folder src
pac solution import --path out.zip --publish-changes
pac model create / pac model list / pac model genpage   # apps and generated React pages
pac pcf push --publisher-prefix <prefix>                # fast inner loop for one control

# Canvas
pac canvas list
pac canvas download --name <app> --file-name app.msapp
pac canvas unpack --msapp app.msapp --sources canvas    # preview; edit *.pa.yaml / Power Fx
pac canvas pack --sources canvas --msapp app.msapp

# Code apps (full custom React UI hosted in Power Apps)
pac code init / pac code add-data-source / pac code run / pac code push
```

Hosts `pac` talks to: `login.microsoftonline.com`, `globaldisco.crm.dynamics.com`,
`api.bap.microsoft.com`, `api.powerplatform.com`, `api.powerapps.com`, plus the
org's own `<org>.crm.dynamics.com` and `<org>.api.crm.dynamics.com`.

## Conventions

- Never commit secrets, auth profiles, `node_modules`, `bin`, or `.msapp` binaries.
  Commit unpacked source and the solution project instead.
- Build before committing: `npm run build` for controls, `dotnet build` for
  solutions and plug-ins.
- Importing or publishing to an environment changes a live tenant. Confirm the
  target with `pac env who` and ask before importing into anything that is not a
  dev environment.
