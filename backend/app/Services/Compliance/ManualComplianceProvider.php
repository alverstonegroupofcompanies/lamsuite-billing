<?php

namespace App\Services\Compliance;

class ManualComplianceProvider implements ComplianceProvider
{
    public function driver(): string
    {
        return 'manual';
    }

    public function label(): string
    {
        return 'Manual portal entry';
    }

    public function supportsIrn(): bool
    {
        return true;
    }

    public function supportsEway(): bool
    {
        return true;
    }
}
