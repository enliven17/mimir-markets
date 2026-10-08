plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The release key stays outside the repo (~/.mimir-android); scripts/android/build-webview.mjs passes it in.
val keystorePath: String? = System.getenv("MIMIR_KEYSTORE")

android {
    namespace = "xyz.mimirmarkets.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "xyz.mimirmarkets.app"
        minSdk = 26
        targetSdk = 36
        // Above every TWA build (1-4), so this installs over it.
        versionCode = 8
        versionName = "2.2.1"
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("MIMIR_KEYSTORE_PASSWORD")
                keyAlias = "mimir"
                keyPassword = System.getenv("MIMIR_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    // WebView passkeys go through Credential Manager (developer.android.com/identity/sign-in/credential-manager-webview).
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
}
