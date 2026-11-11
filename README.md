# Power Apps workspace

Source for custom Power Apps: model-driven apps, canvas apps, code apps, and the
Dataverse solutions, PCF controls, plug-ins and flows behind them. Everything is
built from the command line with the Power Platform CLI (`pac`).

## Getting started

```bash
sudo scripts/setup-toolchain.sh    # .NET SDK 8 + 10 and the pac CLI (Ubuntu)
pac auth create --deviceCode --environment https://<org>.crm.dynamics.com
```

New work lives under `apps/<name>/`. See [CLAUDE.md](CLAUDE.md) for the folder
layout and the build, packaging and deployment commands.
