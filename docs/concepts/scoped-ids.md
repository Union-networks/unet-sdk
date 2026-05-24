# How scoped IDs protect users

A scoped ID is unique per service. A supermarket and a bank receive different identifiers for the same holder, so they cannot correlate accounts through U-net IDs. Services should store the scoped ID as their account key and avoid collecting passwords, emails, or phone numbers unless they have their own explicit reason and consent flow.
