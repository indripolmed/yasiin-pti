<?php
/**
 * Plugin Name: YSII Tracker (SEO & ML)
 * Description: Menghubungkan website dengan Sistem Promosi Digital Terintegrasi SEO & Machine Learning: tracking perilaku (dengan persetujuan), kode referensi WhatsApp, salinan form pendaftaran, dan widget rekomendasi [ysii_reco].
 * Version: 1.0.0
 * Author: Tim PTI Politeknik Negeri Medan
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

const YSII_OPTION = 'ysii_tracker_settings';

function ysii_settings() {
    return wp_parse_args(get_option(YSII_OPTION, []), [
        'api_url'      => 'https://api.ysii.org',
        'privacy_url'  => home_url('/kebijakan-privasi/'),
        'consent'      => 'required',
        'mirror_forms' => 'auto',
        'whatsapp'     => '',
        'daftar_url'   => home_url('/pendaftaran/'),
    ]);
}

// 1) Pasang tracker.js di <head>
add_action('wp_head', function () {
    if (is_admin() || is_user_logged_in() && current_user_can('edit_posts')) {
        return; // jangan rekam admin/editor yang sedang mengelola situs
    }
    $s = ysii_settings();
    printf(
        '<script src="%s" defer data-privacy-url="%s" data-consent="%s" data-mirror-forms="%s"></script>' . "\n",
        esc_url(rtrim($s['api_url'], '/') . '/static/tracker.js'),
        esc_url($s['privacy_url']),
        esc_attr($s['consent']),
        esc_attr($s['mirror_forms'])
    );
    // Tandai halaman program agar slug-nya terbaca (meta "ysii:program" diisi dari custom field)
    if (is_singular()) {
        $slug = get_post_meta(get_the_ID(), 'ysii_program', true);
        if ($slug) {
            printf('<meta name="ysii:program" content="%s">' . "\n", esc_attr($slug));
        }
    }
}, 1);

// 2) Shortcode widget rekomendasi: [ysii_reco]
add_shortcode('ysii_reco', function () {
    $s = ysii_settings();
    return sprintf(
        '<div id="ysii-reco" data-whatsapp="%s" data-daftar-url="%s"></div>',
        esc_attr($s['whatsapp']),
        esc_url($s['daftar_url'])
    );
});

// 3) Halaman pengaturan: Pengaturan > YSII Tracker
add_action('admin_menu', function () {
    add_options_page('YSII Tracker', 'YSII Tracker', 'manage_options', 'ysii-tracker', 'ysii_settings_page');
});

add_action('admin_init', function () {
    register_setting('ysii_tracker', YSII_OPTION, [
        'sanitize_callback' => function ($in) {
            return [
                'api_url'      => esc_url_raw($in['api_url'] ?? ''),
                'privacy_url'  => esc_url_raw($in['privacy_url'] ?? ''),
                'consent'      => in_array($in['consent'] ?? '', ['required', 'implied'], true) ? $in['consent'] : 'required',
                'mirror_forms' => in_array($in['mirror_forms'] ?? '', ['auto', 'marked', 'off'], true) ? $in['mirror_forms'] : 'auto',
                'whatsapp'     => preg_replace('/\D/', '', $in['whatsapp'] ?? ''),
                'daftar_url'   => esc_url_raw($in['daftar_url'] ?? ''),
            ];
        },
    ]);
});

function ysii_settings_page() {
    $s = ysii_settings();
    ?>
    <div class="wrap">
        <h1>YSII Tracker</h1>
        <form method="post" action="options.php">
            <?php settings_fields('ysii_tracker'); ?>
            <table class="form-table" role="presentation">
                <tr><th><label for="api_url">URL API</label></th>
                    <td><input class="regular-text" id="api_url" name="<?php echo YSII_OPTION; ?>[api_url]" value="<?php echo esc_attr($s['api_url']); ?>"></td></tr>
                <tr><th><label for="privacy_url">Halaman kebijakan privasi</label></th>
                    <td><input class="regular-text" id="privacy_url" name="<?php echo YSII_OPTION; ?>[privacy_url]" value="<?php echo esc_attr($s['privacy_url']); ?>"></td></tr>
                <tr><th>Persetujuan cookie</th>
                    <td><select name="<?php echo YSII_OPTION; ?>[consent]">
                        <option value="required" <?php selected($s['consent'], 'required'); ?>>Tampilkan banner (disarankan, UU PDP)</option>
                        <option value="implied" <?php selected($s['consent'], 'implied'); ?>>Tanpa banner</option>
                    </select></td></tr>
                <tr><th>Salin form ke sistem lead</th>
                    <td><select name="<?php echo YSII_OPTION; ?>[mirror_forms]">
                        <option value="auto" <?php selected($s['mirror_forms'], 'auto'); ?>>Otomatis (form yang punya kolom HP/email)</option>
                        <option value="marked" <?php selected($s['mirror_forms'], 'marked'); ?>>Hanya form bertanda data-ysii-form</option>
                        <option value="off" <?php selected($s['mirror_forms'], 'off'); ?>>Mati</option>
                    </select></td></tr>
                <tr><th><label for="whatsapp">No. WhatsApp admin</label></th>
                    <td><input id="whatsapp" name="<?php echo YSII_OPTION; ?>[whatsapp]" value="<?php echo esc_attr($s['whatsapp']); ?>" placeholder="6281234567890"></td></tr>
                <tr><th><label for="daftar_url">URL halaman pendaftaran</label></th>
                    <td><input class="regular-text" id="daftar_url" name="<?php echo YSII_OPTION; ?>[daftar_url]" value="<?php echo esc_attr($s['daftar_url']); ?>"></td></tr>
            </table>
            <?php submit_button(); ?>
        </form>
        <p>Halaman program: isi <em>custom field</em> <code>ysii_program</code> dengan slug program (sama dengan di dashboard),
        atau gunakan URL berpola <code>/program/&lt;slug&gt;</code>. Tambahkan shortcode <code>[ysii_reco]</code> untuk widget rekomendasi.</p>
    </div>
    <?php
}
