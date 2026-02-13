# GH Credential Helper Monitoring

## Health Check

Use the health check script to verify the credential system is working:

```bash
node gh-credential-health-check.js
```

This checks:
- gh authentication status
- git credential.helper configuration
- git operations work
- Token validity

## Scheduled Monitoring

### Windows Task Scheduler

Create a scheduled task to run health checks:

```powershell
# Create task that runs health check hourly
$action = New-ScheduledTaskAction -Execute "node" -Argument "C:\usdz\gh-credential-health-check.js"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -At (Get-Date) -RepetitionDuration (New-TimeSpan -Days 365)
Register-ScheduledTask -TaskName "GH Credential Health Check" -Action $action -Trigger $trigger
```

### Linux/macOS Cron

```bash
# Add to crontab -e
0 * * * * node /path/to/gh-credential-health-check.js >> /var/log/gh-health.log 2>&1
```

## Recovery Procedures

### Quick Reset

If credentials fail but gh is still authenticated:

```bash
node gh-credential-reset.js quick
```

This reconfigures git's credential helper without logging out.

### Full Reset

If authentication is compromised:

```bash
node gh-credential-reset.js full
```

This:
1. Logs out from gh
2. Clears cached credentials
3. Re-authenticates with gh
4. Reconfigures git

## Monitoring Metrics

Key metrics to track:

- **Token validity**: Is the current token valid?
- **Git operation latency**: How long do git operations take?
- **Authentication failures**: How many failed attempts?
- **Credential helper invocations**: How often is gh called?

## Alerting

Set up alerts for:

- Token expiration (when gh reports token near expiration)
- Network errors to github.com
- Credential helper failures
- Multiple authentication failures

## Logging

Enable git credential logging for debugging:

```bash
export GIT_TRACE=1
export GIT_TRACE_PERFORMANCE=1
git fetch origin
```

This will show:
- When git calls the credential helper
- Time taken for credential retrieval
- Success/failure of operations
