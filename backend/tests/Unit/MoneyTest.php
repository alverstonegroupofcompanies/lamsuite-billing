<?php

namespace Tests\Unit;

use App\Support\Money;
use PHPUnit\Framework\TestCase;

class MoneyTest extends TestCase
{
    public function test_sums_decimal_money_without_binary_noise(): void
    {
        $this->assertSame(0.3, Money::sum([0.1, 0.2]));
        $this->assertSame(409.61, Money::sum([204.82, 204.79]));
        $this->assertSame(134.61, Money::sum([67.31, 67.30]));
    }

    public function test_rounds_a_float_to_paise(): void
    {
        $this->assertSame(204.82, Money::round2(204.81999999999994));
        $this->assertSame(409.61, Money::round2(409.60999999999984));
        $this->assertSame(0.3, Money::round2(0.30000000000000004));
    }

    public function test_converts_decimal_strings_to_integer_paise(): void
    {
        $this->assertSame(108000, Money::paise('1080.00'));
        $this->assertSame(20482, Money::paise(204.82));
        $this->assertSame(34, Money::paise('0.34'));
        $this->assertSame(0, Money::paise(null));
    }
}
