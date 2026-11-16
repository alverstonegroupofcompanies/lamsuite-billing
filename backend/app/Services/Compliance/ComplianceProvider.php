<?php

namespace App\Services\Compliance;

/**
 * Statutory e-invoicing/e-way bill driver contract.
 *
 * The platform deliberately ships without a GSP/IRP integration. The manual
 * driver records IRN/EWB references obtained from the government portal so a
 * compliant workflow exists today; a future GSP driver can implement this
 * contract without touching invoice or admin code.
 */
interface ComplianceProvider
{
    public function driver(): string;

    public function label(): string;

    public function supportsIrn(): bool;

    public function supportsEway(): bool;
}
