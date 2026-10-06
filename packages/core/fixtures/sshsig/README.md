# OpenSSH SSHSIG test vectors

`ed25519_sk.pub`, `ed25519_sk.sig`, `namespace`, and `signed-data` are
copied unchanged from OpenSSH portable,
`regress/unittests/sshsig/testdata/` (BSD licence, as OpenSSH). They are a
real `sk-ssh-ed25519@openssh.com` signature with namespace `unittest`,
flags `0x01`, and counter `0x12345678`, made by OpenSSH's own test
authenticator. `core/test/seal-sshsig.test.ts` checks that Gnomon's
verifier (schema §11.8) accepts it, so the FIDO wire format is tested
against OpenSSH and not only against our reading of it.
