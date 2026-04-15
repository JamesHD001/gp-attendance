$urls = @(
    'http://localhost:3000/pages/admin-dashboard.html',
    'http://localhost:3000/pages/instructor-dashboard.html',
    'http://localhost:3000/pages/leader-dashboard.html',
    'http://localhost:3000/js/modules/admin-dashboard.js',
    'http://localhost:3000/js/modules/instructor-dashboard.js',
    'http://localhost:3000/js/modules/leader-dashboard.js'
)

foreach ($u in $urls) {
    try {
        $r = Invoke-WebRequest -Uri $u -Method Head -UseBasicParsing -TimeoutSec 5
        Write-Output "$u -> $($r.StatusCode)"
    } catch {
        if ($_.Exception.Response -ne $null) {
            Write-Output "$u -> FAIL: $($_.Exception.Response.StatusCode.Value__) $($_.Exception.Message)"
        } else {
            Write-Output "$u -> FAIL: $($_.Exception.Message)"
        }
    }
}
