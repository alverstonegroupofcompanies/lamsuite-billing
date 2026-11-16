<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Auth\PasswordResetService;
use Illuminate\Console\Command;

class PasswordResetLinkCommand extends Command
{
    protected $signature = 'auth:reset-link {user : User ID, username, or email}';
    protected $description = 'Generate a one-time admin password reset link (for installs without SMTP)';

    public function handle(PasswordResetService $resets): int
    {
        $target = (string) $this->argument('user');

        $user = is_numeric($target)
            ? User::find($target)
            : User::where('username', $target)->orWhere('email', $target)->first();

        if (!$user) {
            $this->error("User not found: '{$target}'");
            return 1;
        }

        $token = $resets->issue($user);

        $this->info('Password reset link generated.');
        $this->line('User:        ' . $user->name . ' (' . $user->email . ')');
        $this->line('Expires in:  ' . PasswordResetService::TOKEN_TTL_MINUTES . ' minutes');
        $this->line('Reset URL:   ' . $resets->resetUrl($user, $token));
        $this->line('Reset code:  ' . $token);

        return 0;
    }
}
