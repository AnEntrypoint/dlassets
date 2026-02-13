# GitHub CLI Credential Helper Configuration

## Overview

This system uses GitHub CLI (gh) as the git credential helper for HTTPS authentication to GitHub. This provides secure, automatic credential management without requiring personal access tokens in git config or environment variables.

## Current Configuration

### System State
- **gh CLI Version**: Available at C:\Program Files\GitHub CLI\gh.exe
- **Authentication**: Logged in to github.com as lanmower
- **Git Credential Helper**: Configured globally to use 'gh'
- **Token Scopes**: gist, read:org, repo, workflow

### Git Configuration
```
[credential]
  helper = gh
```

This setting is in your user's .gitconfig file (usually at ~/.gitconfig on Unix or %USERPROFILE%\.gitconfig on Windows).

## How It Works

1. **User runs a git command** that needs authentication:
   ```
   git push https://github.com/user/repo.git
   git fetch https://github.com/user/repo.git
   git clone https://github.com/user/repo.git
   ```

2. **Git calls credential helper** for https://github.com URLs:
   - Git looks up credential.helper configuration
   - Finds it's set to 'gh'
   - Executes: `gh credential-oauth` (or `gh credential-fill`)

3. **gh provides authentication**:
   - Retrieves token from system credential storage (Windows: Credential Manager, macOS: Keychain, Linux: credential-cache)
   - Returns token in git credential format
   - Git uses token for HTTPS authentication

4. **Request succeeds**:
   - GitHub receives valid token
   - Operation completes without user prompts

## Verification

To verify the setup is working:

```bash
# Check gh is authenticated
gh auth status

# Check git credential helper is set
git config --global credential.helper

# Test git operations
git fetch origin --dry-run
git ls-remote origin
```

## Security Characteristics

- **Tokens never stored in plaintext**: Stored in system credential manager
- **Tokens never logged**: git logs don't contain tokens
- **Tokens never cached in memory long-term**: Credential manager handles caching
- **Scope-limited tokens**: Token has only necessary GitHub API scopes
- **Revocable**: Token can be revoked immediately in GitHub settings
- **Per-host configuration**: Can use different credentials for different hosts

## Troubleshooting

### "fatal: Authentication failed"

**Cause**: gh token is invalid or revoked

**Solution**:
```bash
gh auth refresh
# or
gh auth login
```

### "gh: command not found"

**Cause**: gh CLI not installed or not in PATH

**Solution**:
1. Install gh from https://cli.github.com
2. Verify: `gh --version`

### "credential.helper is not set"

**Cause**: Git doesn't know to use gh for credentials

**Solution**:
```bash
git config --global credential.helper gh
```

### Git prompts for credentials despite gh auth

**Cause**: Possible SSH vs HTTPS confusion, or gh not in PATH

**Solution**:
```bash
# Verify gh is accessible
where gh  # Windows
which gh  # Unix

# Verify git config
git config --global --get credential.helper

# Force HTTPS (not SSH)
git remote -v
# Should show: https://github.com/user/repo.git
# Not:         git@github.com:user/repo.git
```

## Advanced Configuration

### Using Multiple GitHub Accounts

To use different credentials for different GitHub hosts:

```bash
# Configure different helper per host
git config --global --unset credential.helper
git config --global credential.https://github.com.helper gh
git config --global credential.https://my-github.company.com.helper gh
```

### Debugging Credential Helper

To see what's happening when git needs credentials:

```bash
# Enable debug logging
GIT_TRACE=1 git fetch origin

# Or more detailed
GIT_CURL_VERBOSE=1 GIT_TRACE=1 git fetch origin
```

## Token Refresh

gh automatically refreshes tokens in the background, but you can manually refresh:

```bash
# Refresh token
gh auth refresh

# Logout and login again
gh auth logout
gh auth login
```

## Related Documentation

- [GitHub CLI Credential Helper](https://cli.github.com/manual/gh_credential)
- [Git Credential Helper](https://git-scm.com/docs/gitcredentials)
- [GitHub Token Authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github)

## Testing Checklist

- [x] gh CLI installed and version verified
- [x] User authenticated to github.com
- [x] credential.helper set to 'gh' globally
- [x] git fetch works without prompting
- [x] git status works without prompting
- [x] git operations use gh token
- [x] Multiple sequential git commands work
- [x] Token caching works correctly
- [x] Public repo access works
- [x] Network errors handled gracefully
