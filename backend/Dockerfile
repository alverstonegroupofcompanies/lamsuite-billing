# syntax=docker/dockerfile:1.4

# Stage 1: Vendor build (composer)
FROM composer:2.8 AS vendor

WORKDIR /app

COPY composer.json composer.lock ./

RUN composer install \
    --no-dev \
    --no-interaction \
    --prefer-dist \
    --optimize-autoloader \
    --no-scripts \
    --ignore-platform-reqs

# Stage 2: Production Base with FrankenPHP
FROM dunglas/frankenphp:1.4-php8.3-alpine AS base

# Install required system libraries and PHP extensions
RUN install-php-extensions \
    pdo_mysql \
    pdo_sqlite \
    bcmath \
    pcntl \
    opcache \
    zip \
    intl

# Build phpredis directly from GitHub to bypass PECL metadata errors.
RUN apk add --no-cache --virtual .redis-build-deps \
        autoconf gcc g++ make musl-dev linux-headers re2c \
    && curl -fsSL https://github.com/phpredis/phpredis/archive/refs/tags/6.2.0.tar.gz -o /tmp/phpredis.tar.gz \
    && tar -xzf /tmp/phpredis.tar.gz -C /tmp \
    && cd /tmp/phpredis-6.2.0 \
    && phpize \
    && ./configure --enable-redis \
    && make -j2 \
    && make install \
    && echo "extension=redis.so" > /usr/local/etc/php/conf.d/redis.ini \
    && cd / \
    && rm -rf /tmp/phpredis-6.2.0 /tmp/phpredis.tar.gz \
    && apk del .redis-build-deps

# Production PHP settings
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" && \
    sed -i 's/expose_php = On/expose_php = Off/' "$PHP_INI_DIR/php.ini" && \
    sed -i 's/memory_limit = 128M/memory_limit = 512M/' "$PHP_INI_DIR/php.ini" && \
    sed -i 's/max_execution_time = 30/max_execution_time = 60/' "$PHP_INI_DIR/php.ini" && \
    sed -i 's/upload_max_filesize = 2M/upload_max_filesize = 50M/' "$PHP_INI_DIR/php.ini" && \
    sed -i 's/post_max_size = 8M/post_max_size = 50M/' "$PHP_INI_DIR/php.ini"

# Set up application directory
WORKDIR /var/www/html

# Copy application files
COPY --chown=www-data:www-data . /var/www/html

# Copy vendor from vendor stage
COPY --from=vendor --chown=www-data:www-data /app/vendor /var/www/html/vendor

# Copy Caddyfile configuration
COPY docker/Caddyfile /etc/caddy/Caddyfile

# Generate optimized autoload and prepare storage permissions
RUN php artisan package:discover --ansi && \
    mkdir -p /var/www/html/storage/framework/{sessions,views,cache} /var/www/html/storage/logs /var/www/html/bootstrap/cache && \
    chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache && \
    chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache

# Copy docker entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER www-data

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Stage 3: API Web Server (Default)
FROM base AS api

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://127.0.0.1:8000/up || exit 1

CMD ["frankenphp", "run", "--config", "/etc/caddy/Caddyfile"]
