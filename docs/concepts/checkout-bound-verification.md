# Provider-bound verification

Sovereign Core V2 removes the central checkout API. Providers keep checkout state locally and create a hosted verification session only for the checks required by that transaction.

Bind the verifier session reference to the provider-owned checkout record, accept the proof outcome once, and expire both records together. Do not persist disclosed claims when a pass, warning, or failure outcome is sufficient.
