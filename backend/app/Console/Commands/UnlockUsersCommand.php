<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class UnlockUsersCommand extends Command
{
    protected $signature = 'users:unlock {user? : Optional user ID, username, or email to unlock (default: all)}';
    protected $description = 'Unlock user accounts and reset failed login attempts counter';

    public function handle(): int
    {
        $target = $this->argument('user');

        if (!$target) {
            $count = User::whereNotNull('locked_until')
                ->orWhere('failed_login_attempts', '>', 0)
                ->count();

            User::query()->update([
                'locked_until' => null,
                'failed_login_attempts' => 0,
            ]);

            $this->info("Successfully unlocked all user accounts ({$count} accounts updated).");
            return 0;
        }

        $user = is_numeric($target)
            ? User::find($target)
            : User::where('username', $target)->orWhere('email', $target)->first();

        if (!$user) {
            $this->error("User not found: '{$target}'");
            return 1;
        }

        $user->update([
            'locked_until' => null,
            'failed_login_attempts' => 0,
        ]);

        $this->info("User '{$user->name}' (ID: {$user->id}, Username: {$user->username}) has been unlocked successfully.");
        return 0;
    }
}
