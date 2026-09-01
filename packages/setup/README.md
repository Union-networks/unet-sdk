# @union-networks/setup

Generate provider secrets locally from the setup manifest downloaded from the U-net dashboard:

```sh
npx @union-networks/setup configure --manifest unet-setup.json --out .env.local --public-out unet-registration.json
```

Provider-owned values may be supplied without placing them in the downloaded manifest:

```sh
npx @union-networks/setup configure --manifest unet-setup.json --out .env.local --public-out unet-registration.json --database-url "$DATABASE_URL" --session-secret "$SESSION_SECRET"
```

For a dashboard-selected custom issuer, pass its immutable ID with `--issuer-id`.

Only upload `unet-registration.json`. The generated `.env.local` and private keys remain on provider infrastructure.
