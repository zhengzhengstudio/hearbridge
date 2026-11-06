plugins {
    id("com.android.application")
}

android {
    namespace = "cn.zhengzhengstudio.boardgames"
    compileSdk = 36

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    signingConfigs {
        create("storeRelease") {
            val storeFilePath = System.getenv("BOARDGAMES_ANDROID_STORE_FILE")
            if (!storeFilePath.isNullOrBlank()) {
                storeFile = file(storeFilePath)
            }
            storePassword = System.getenv("BOARDGAMES_ANDROID_STORE_PASSWORD")
            keyAlias = System.getenv("BOARDGAMES_ANDROID_KEY_ALIAS") ?: "boardgames-release"
            keyPassword = System.getenv("BOARDGAMES_ANDROID_KEY_PASSWORD")
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("direct") {
            dimension = "distribution"
            buildConfigField("boolean", "DIRECT_UPDATES", "true")
            signingConfig = signingConfigs.getByName("storeRelease")
        }
        create("store") {
            dimension = "distribution"
            buildConfigField("boolean", "DIRECT_UPDATES", "false")
            signingConfig = signingConfigs.getByName("storeRelease")
        }
    }

    defaultConfig {
        applicationId = "cn.zhengzhengstudio.boardgames"
        minSdk = 24
        targetSdk = 36
        versionCode = 32
        versionName = "1.4.0"
    }

}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
}
