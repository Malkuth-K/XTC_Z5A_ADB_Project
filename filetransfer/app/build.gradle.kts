/*
 * 雷霆Link（ThunderLink）— app 模块构建脚本
 * 双 flavor：
 *   - watch：小天才 Z5A（Android 7.1.1 / API 25，320x360 小屏），包名 malkuth.k.filetransfer
 *   - phone：Android 手机（大屏），包名 malkuth.k.filetransfer.phone
 */

import java.util.Properties
import java.io.FileInputStream

// 加载签名配置（不存在则 release 走 unsigned）
val keystoreProperties = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) load(FileInputStream(f))
}

// APK 输出目录：项目根目录 ../apk/
val apkOutputDir = rootProject.file("../apk")

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "malkuth.k.filetransfer"
    compileSdk = 36

    defaultConfig {
        applicationId = "malkuth.k.filetransfer"
        minSdk = 25
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        vectorDrawables.useSupportLibrary = true
    }

    // ===== 产品变体：watch（手表） / phone（手机）=====
    flavorDimensions += "form"
    productFlavors {
        create("watch") {
            dimension = "form"
            applicationId = "malkuth.k.filetransfer"
            versionNameSuffix = "-watch"
            resValue("string", "app_form", "watch")
        }
        create("phone") {
            dimension = "form"
            applicationId = "malkuth.k.filetransfer.phone"
            versionNameSuffix = "-phone"
            resValue("string", "app_form", "phone")
        }
    }

    signingConfigs {
        create("release") {
            val storeFilePath = keystoreProperties.getProperty("storeFile", "")
            if (storeFilePath.isNotEmpty()) {
                storeFile = file(storeFilePath)
                storePassword = keystoreProperties.getProperty("storePassword", "")
                keyAlias = keystoreProperties.getProperty("keyAlias", "")
                keyPassword = keystoreProperties.getProperty("keyPassword", "")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null && releaseSigning.storeFile!!.exists()) {
                signingConfig = releaseSigning
            }
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
    }

    // ===== 自定义 APK 输出路径：../../apk/ =====
    applicationVariants.all {
        val variant = this
        variant.outputs.all {
            val output = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            val apkName = "thunderlink-${variant.name}.apk"
            output.outputFileName = apkName
        }
        // 构建完成后复制 APK 到目标目录
        variant.assembleProvider?.get()?.doLast {
            variant.outputs.forEach { output ->
                val srcFile = output.outputFile
                if (srcFile != null && srcFile.exists()) {
                    apkOutputDir.mkdirs()
                    val destFile = File(apkOutputDir, srcFile.name)
                    srcFile.copyTo(destFile, overwrite = true)
                    println("[THUNDERLINK] APK copied to: ${destFile.absolutePath}")
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources.excludes += listOf(
            "META-INF/*.kotlin_module",
            "META-INF/AL2.0",
            "META-INF/LGPL2.1",
            "META-INF/DEPENDENCIES",
            "META-INF/LICENSE",
            "META-INF/LICENSE.txt",
            "META-INF/NOTICE",
            "META-INF/NOTICE.txt"
        )
    }
}

dependencies {
    // ===== AndroidX =====
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    // ===== 协程 =====
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // ===== OkHttp（HTTP 客户端，传输层）=====
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okio:okio:3.9.1")

    // ===== JSON 解析（kotlinx-serialization 轻量）=====
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}
